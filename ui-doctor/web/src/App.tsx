import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { ToastProvider } from './components/ui/Toast';
import { AnalysisPage } from './pages/AnalysisPage';
import { DashboardPage } from './pages/DashboardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProjectPage } from './pages/ProjectPage';
import { ProjectsPage } from './pages/ProjectsPage';

export function AppRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/painel" element={<DashboardPage />} />
        <Route path="/projetos" element={<ProjectsPage />} />
        <Route path="/projetos/:id" element={<ProjectPage />} />
        <Route path="/analises/:id" element={<AnalysisPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ToastProvider>
  );
}
