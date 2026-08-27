import { NavLink } from 'react-router-dom';
import './Nav.css';

/** Пять экранов петли. Порядок повторяет порядок шагов, а не частоту использования. */
const TABS = [
  { to: '/',         label: 'Улов' },
  { to: '/patterns', label: 'Паттерны' },
  { to: '/reading',  label: 'Чтение' },
  { to: '/lexicon',  label: 'Сонник' },
];

export function Nav() {
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) => 'nav__item' + (isActive ? ' nav__item--on' : '')}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
