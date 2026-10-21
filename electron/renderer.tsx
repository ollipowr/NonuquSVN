import { App } from '@nonu/app/App';
import { setPanelHost } from '@nonu/stores';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createElectronAdapter } from './host.js';
import './theme.css';

const adapter = createElectronAdapter();
setPanelHost(adapter);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App adapter={adapter} />
    </React.StrictMode>,
  );
}
