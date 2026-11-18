import React from 'react';
import ReactDOM from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles/global.css';
// UI redesign (design system, shell, map controls) - loaded after the base styles.
import './styles/redesign.css';
import './theme';
import App from './App';
import { registerServiceWorker } from './offline/registerServiceWorker';

registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
