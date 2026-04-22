import { Routes, Route, Navigate } from "react-router-dom";
import './App.css'

import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";

// Invoices
import Invoices from "./pages/Invoices";
import InvoiceUPS from "./pages/invoices/InvoiceUPS";
import InvoiceTNT from "./pages/invoices/InvoiceTNT";

// Pickups
import Pickups from "./pages/Pickups";
import PickupUPS from "./pages/pickups/PickupUPS";
import PickupTNT from "./pages/pickups/PickupTNT";
import PickupFedex from "./pages/pickups/PickupFedex";
import PickupDHL from "./pages/pickups/PickupDHL";

// Autres pages
import Palettes from "./pages/Palettes";
import Connection from "./pages/Connection";

function App() {
  return (
    <div className="app">
      <Navbar />

      <div className="container">
        <Routes>
          {/* Dashboard */}
          <Route path="/" element={<Dashboard />} />

          {/* Invoices */}
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/invoices/ups" element={<InvoiceUPS />} />
          <Route path="/invoices/tnt" element={<InvoiceTNT />} />

          {/* Pickups */}
          <Route path="/pickups" element={<Pickups />} />
          <Route path="/pickups/ups" element={<PickupUPS />} />
          <Route path="/pickups/tnt" element={<PickupTNT />} />
          <Route path="/pickups/fedex" element={<PickupFedex />} />
          <Route path="/pickups/dhl" element={<PickupDHL />} />

          {/* Palettes */}
          <Route path="/palettes" element={<Palettes />} />

          {/* Connection */}
          <Route path="/connection" element={<Connection />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  )
}

export default App
