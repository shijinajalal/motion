const LINKS = [
  { label: 'WORK', href: '#work' },
  { label: 'ABOUT', href: '#about' },
  { label: 'CONTACT', href: '#contact' },
]

export default function Nav() {
  return (
    <header className="nav">
      <nav className="nav__pill" aria-label="Primary">
        {LINKS.map((l) => (
          <a key={l.label} className="nav__link" href={l.href}>
            {l.label}
          </a>
        ))}
      </nav>
    </header>
  )
}
