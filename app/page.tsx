const metrics = [
  { label: "Wind", value: "Waiting for WS-2902" },
  { label: "Pressure trend", value: "Waiting for WS-2902" },
  { label: "Rain", value: "Waiting for WS-2902" },
  { label: "Solar", value: "Waiting for WS-2902" },
];

export default function Home() {
  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">BRIDGEPORT · CHICAGO</p>
          <h1>Storm Watch</h1>
        </div>
        <span className="live"><i /> SETUP</span>
      </header>

      <section className="hero calm">
        <p className="kicker">LOCAL SEVERE WEATHER</p>
        <h2>Monitoring Bridgeport</h2>
        <p className="summary">No live storm assessment yet. The app foundation is ready for your WS-2902 and severe-weather feeds.</p>
        <div className="statusRow">
          <div><span>Threat</span><strong>Not assessed</strong></div>
          <div><span>Storm trend</span><strong>Waiting for radar</strong></div>
        </div>
      </section>

      <section>
        <div className="sectionTitle"><h3>At the station</h3><span>WS-2902</span></div>
        <div className="grid">
          {metrics.map((metric) => (
            <article className="metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </div>
        <p className="note">Raw observations will be retained. Temperature, rainfall and elevated wind can be quality-controlled separately as we learn this installation.</p>
      </section>

      <section className="panel">
        <div className="sectionTitle"><h3>Storm evolution</h3><span>COMING NEXT</span></div>
        <div className="trend">
          <span className="dot" />
          <div><strong>Strengthening · Steady · Weakening</strong><p>Successive radar and severe-weather observations will be compared to explain how storms are changing as they approach Bridgeport.</p></div>
        </div>
      </section>

      <footer>Bridgeport Severe Weather · V0.1</footer>
    </main>
  );
}
