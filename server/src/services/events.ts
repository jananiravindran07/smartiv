import type { Response } from 'express';
import type { User } from '../db/schema.js';
import type { BedSnapshot } from './beds.js';

interface Client {
  response: Response;
  user: User;
  bedIds: Set<number>;
}

/**
 * Server-sent events. Every write is filtered per client, so a nurse's browser
 * is never sent another nurse's beds even though they share one process.
 */
export class LiveEvents {
  private readonly clients = new Set<Client>();

  add(response: Response, user: User, bedIds: number[]): Client {
    const client: Client = { response, user, bedIds: new Set(bedIds) };
    this.clients.add(client);
    response.on('close', () => this.clients.delete(client));
    return client;
  }

  private write(event: string, data: unknown, predicate: (client: Client) => boolean) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      if (!predicate(client)) continue;
      try {
        client.response.write(frame);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private canSeeBed(client: Client, bedId: number): boolean {
    return client.user.role === 'admin' || client.bedIds.has(bedId);
  }

  publishBedUpdate(bedId: number, bed: BedSnapshot) {
    this.write('bed', { bed }, (client) => this.canSeeBed(client, bedId));
  }

  /** Fires when a bed crosses into critical, which is what the alarm listens for. */
  publishCritical(bedId: number, bed: BedSnapshot) {
    this.write('critical', { bed }, (client) => this.canSeeBed(client, bedId));
  }

  publishSnapshot(beds: BedSnapshot[]) {
    this.write('snapshot', { beds }, () => true);
  }

  /** Called after an assignment change so a nurse's live set follows the database. */
  refreshAssignments(userId: string, bedIds: number[]) {
    for (const client of this.clients) {
      if (client.user.id === userId) client.bedIds = new Set(bedIds);
    }
  }

  closeAll() {
    for (const client of this.clients) {
      try {
        client.response.end();
      } catch {
        // the socket is already gone
      }
    }
    this.clients.clear();
  }

  get size() {
    return this.clients.size;
  }
}
