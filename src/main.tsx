import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PrefsProvider } from './lib/i18n';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrefsProvider>
      <App />
    </PrefsProvider>
  </React.StrictMode>,
);
