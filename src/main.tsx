import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import '@fontsource-variable/instrument-sans/index.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/tiro-devanagari-hindi/400.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Installable app + offline start (production web build only; not inside the single-file demo).
if (import.meta.env.PROD && import.meta.env.MODE !== 'single' && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => undefined); });
}
