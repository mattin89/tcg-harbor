import React from 'react';
import ReactDOM from 'react-dom/client';
import ProductionAppV2 from './ProductionApp_v2';
import './styles.css';
import './styles-community.css';
import './styles-secondary.css';
import './styles-responsive.css';
import './styles-market-comparison.css';
import './styles-contrast-v2.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ProductionAppV2 /></React.StrictMode>,
);
