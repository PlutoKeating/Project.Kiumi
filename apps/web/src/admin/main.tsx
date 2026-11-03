import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './AdminApp.tsx';
import '../styles.css';
import './admin.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(<React.StrictMode><AdminApp /></React.StrictMode>);
