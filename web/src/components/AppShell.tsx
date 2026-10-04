import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Activity, LogOut, Shield, User, Bell, Building2, Users, Cpu, SlidersHorizontal, ScrollText, Stethoscope, LayoutDashboard } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { ROLE_LABEL, navFor, type NavItem } from '../lib/permissions';

const ICONS: Record<string, typeof Activity> = {
  '/my-patients': Stethoscope, '/ward': LayoutDashboard, '/admin': Shield,
  '/admin/users': Users, '/admin/wards': Building2, '/admin/devices': Cpu,
  '/admin/parameters': SlidersHorizontal, '/admin/audit': ScrollText,
};

export function AppShell() {
  const profile = useAuthStore((s) => s.profile);
  const role = useAuthStore((s) => s.role);
  const wardId = useAuthStore((s) => s.wardId);
  const signOut = useAuthStore((s) => s.signOut);
  const navigate = useNavigate();
  const location = useLocation();
  const items: NavItem[] = navFor(role);
  const handleSignOut = async () => { await signOut(); navigate('/login', { replace: true }); };
  const pageLabel = items.find((item) => location.pathname === item.to || (item.to !== '/admin' && location.pathname.startsWith(item.to)))?.label ?? 'Overview';

  return (
    <div className="app-canvas">
      <div className="app-frame">
        <aside className="app-sidebar">
          <a className="brand-lockup" href={role ? items[0]?.to : '/login'}>
            <span className="brand-mark"><Activity size={20} strokeWidth={2} /></span>
            <span><strong>SmartIV</strong><small>Care, in real time</small></span>
          </a>
          <div className="nav-caption">WORKSPACE</div>
          <nav className="side-nav" aria-label="Main navigation">
            {items.map((item) => {
              const Icon = ICONS[item.to] ?? Bell;
              return <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}>
                <Icon size={18} strokeWidth={1.8} /><span>{item.label}</span>
              </NavLink>;
            })}
          </nav>
          <div className="sidebar-spacer" />
          <div className="sidebar-note"><span className="live-dot" /><span>Monitoring is active<small>Updates appear as they arrive</small></span></div>
          <button className="signout-pill" onClick={() => void handleSignOut()}><LogOut size={16} /> Sign out</button>
        </aside>

        <section className="app-main">
          <header className="topbar">
            <div className="topbar-title"><span className="eyebrow">SMARTIV / {role ? ROLE_LABEL[role].toUpperCase() : 'CARE TEAM'}</span><h1>{pageLabel}</h1></div>
            <div className="topbar-tools">
              <div className="ward-chip"><Building2 size={15} /> {role === 'ADMIN' ? 'All wards' : `Ward ${wardId ? wardId.slice(0, 8) : '—'}`}</div>
              <button className="icon-button" aria-label="Notifications"><Bell size={18} /><i /></button>
              <div className="user-pill"><span className="user-avatar">{(profile?.full_name ?? 'U').split(/\s+/).map((part) => part[0]).slice(0,2).join('').toUpperCase()}</span><span><strong>{profile?.full_name ?? 'Care team'}</strong><small>{role ? ROLE_LABEL[role] : '—'}</small></span><User size={15} className="user-end" /></div>
            </div>
          </header>
          <main className="page-content"><Outlet /></main>
          <footer className="app-footer">Academic prototype · Not a certified medical device</footer>
        </section>
      </div>
    </div>
  );
}
