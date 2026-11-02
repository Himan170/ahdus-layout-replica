import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './ui/theme.css';
import { applyStudioLook } from './ui/look';

applyStudioLook();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
