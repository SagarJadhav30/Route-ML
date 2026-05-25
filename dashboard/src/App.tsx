import { Routes, Route, NavLink } from "react-router-dom";
import Predict from "./pages/Predict";
import Compare from "./pages/Compare";

function Nav() {
  const link = (to: string, label: string) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? "bg-blue-600 text-white"
            : "text-gray-400 hover:text-white hover:bg-gray-800"
        }`
      }
    >
      {label}
    </NavLink>
  );

  return (
    <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight text-white">
            route<span className="text-blue-500">ml</span>
          </span>
          <span className="text-xs text-gray-500 hidden sm:inline">
            ML-powered ETA predictions
          </span>
        </div>
        <nav className="flex gap-2">
          {link("/", "Predict")}
          {link("/compare", "Compare")}
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <Routes>
          <Route path="/" element={<Predict />} />
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </main>
      <footer className="border-t border-gray-800 py-4 text-center text-xs text-gray-600">
        routeml &mdash; ML beats formulas. Built by Nityam.
      </footer>
    </div>
  );
}
