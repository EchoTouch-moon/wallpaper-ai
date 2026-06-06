import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing-shell">
      <div className="landing-grain" />
      <section className="landing-copy">
        <p className="eyebrow">AI Wallpaper Studio / 001</p>
        <h1>
          Compose the space
          <br />
          around your memories.
        </h1>
        <p className="landing-description">
          一个面向壁纸设计的可编辑照片画布。先完成构图，再让 AI 提供布局建议。
        </p>
        <Link className="primary-link" href="/editor">
          打开编辑工作台
          <span aria-hidden="true">↗</span>
        </Link>
      </section>
      <aside className="landing-index" aria-label="Project principles">
        <span>01 / Editable layout JSON</span>
        <span>02 / Wallpaper safe areas</span>
        <span>03 / Full-resolution export</span>
      </aside>
    </main>
  );
}
