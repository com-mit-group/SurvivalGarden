import { Navigate, NavLink, Route, Routes } from 'react-router-dom';

function BedsPage() {
  return <p>Beds</p>;
}

function CalendarPage() {
  return <p>Calendar</p>;
}

function BatchesPage() {
  return <p>Batches</p>;
}

function NutritionPage() {
  return <p>Nutrition</p>;
}

function DataPage() {
  return <p>Data</p>;
}

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>SurvivalGarden</h1>
      </header>

      <main className="app-content">
        <Routes>
          <Route path="/" element={<Navigate to="/beds" replace />} />
          <Route path="/beds" element={<BedsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/batches" element={<BatchesPage />} />
          <Route path="/nutrition" element={<NutritionPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="*" element={<Navigate to="/beds" replace />} />
        </Routes>
      </main>

      <nav className="tab-nav" aria-label="Primary">
        <NavLink to="/beds">Beds</NavLink>
        <NavLink to="/calendar">Calendar</NavLink>
        <NavLink to="/batches">Batches</NavLink>
        <NavLink to="/nutrition">Nutrition</NavLink>
        <NavLink to="/data">Data</NavLink>
      </nav>
    </div>
  );
}

export default App;
