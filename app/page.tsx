import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing-shell">
      <span className="landing-orb one" aria-hidden="true" />
      <span className="landing-orb two" aria-hidden="true" />
      <div className="landing-card glass-surface">
        <section className="landing-copy">
          <p className="eyebrow">AI Wallpaper Studio</p>
          <h1>
            Your memories,
            <span>beautifully placed.</span>
          </h1>
          <p className="landing-description">
            一个为屏幕而生的照片设计画布。自由编排每一张影像，让留白、比例与回忆自然流动。
          </p>
          <Link className="primary-link" href="/editor">
            打开编辑工作台
            <span aria-hidden="true">→</span>
          </Link>
        </section>
        <aside className="landing-index" aria-label="Project principles">
          <span>Editable compositions</span>
          <span>Wallpaper-aware space</span>
          <span>Full-resolution output</span>
        </aside>
      </div>
    </main>
  );
}
