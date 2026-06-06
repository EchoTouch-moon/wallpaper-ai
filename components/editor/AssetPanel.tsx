export function AssetPanel() {
  return (
    <aside className="side-panel left editor-glass">
      <div className="panel-heading">
        <h2>Assets</h2>
        <span>0 items</span>
      </div>
      <div className="upload-placeholder">
        <p>
          <span className="upload-icon" aria-hidden="true">
            +
          </span>
          <strong>Add your photos</strong>
          Drop JPG, PNG or WebP here
        </p>
      </div>
    </aside>
  );
}
