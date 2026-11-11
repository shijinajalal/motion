function ArrowIcon() {
  return (
    <svg
      className="btn__arrow"
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 8h10M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function Hero() {
  return (
    <section className="hero" aria-label="Introduction">
      <p className="hero__hi">Hi, I&rsquo;m</p>
      <h1 className="hero__name">Imthiyas</h1>
      <p className="hero__bio">
        Full Stack Developer crafting fast, accessible interfaces and robust
        APIs — turning ideas into polished products from concept to deployment.
      </p>
      <div className="hero__actions">
        <a className="btn btn--solid" href="#resume">
          Resume <ArrowIcon />
        </a>
        <a className="btn btn--ghost" href="#contact">
          Let&rsquo;s Talk
        </a>
      </div>
      <a
        className="hero__site"
        href="https://imthiyasdesign.com"
        target="_blank"
        rel="noreferrer"
      >
        imthiyasdesign.com
      </a>
    </section>
  )
}
