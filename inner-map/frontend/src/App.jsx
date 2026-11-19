import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/AuthContext';
import { ConnectivityProvider } from './hooks/ConnectivityContext';
import { LocationProvider } from './hooks/LocationContext';
import { ProviderProvider } from './hooks/ProviderContext';
import { TypographyProvider } from './hooks/TypographyContext';
import { ConfirmHost } from './components/ConfirmDialog';
// Locally bundled fonts for the typography settings (no external font service).
import './typography/fonts';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './layouts/AppLayout';
import PublicLayout from './layouts/PublicLayout';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import MapPage from './pages/MapPage';
import DownloadPage from './pages/DownloadPage';
import MyMapsPage from './pages/MyMapsPage';
import SavedLocationsPage from './pages/SavedLocationsPage';
import LayersPage from './pages/LayersPage';
import GlobeLoader from './components/GlobeLoader';
// Registers the layer/feature sync handlers before the first outbox flush.
import './services/featureService';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <AuthProvider>
      <ConnectivityProvider>
        <LocationProvider>
          <ProviderProvider>
          <TypographyProvider>
          <BrowserRouter>
            <Routes>
              {/* Start screen: the 3D Earth (full screen, for everyone; saving needs an account) */}
              <Route path="/" element={<GlobeLoader />} />
              <Route element={<PublicLayout />}>
                <Route path="/welcome" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
              </Route>
              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/map" element={<MapPage />} />
                <Route path="/download" element={<DownloadPage />} />
                <Route path="/my-maps" element={<MyMapsPage />} />
                <Route path="/saved" element={<SavedLocationsPage />} />
                <Route path="/layers" element={<LayersPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="/home" element={<Navigate to="/" replace />} />
              <Route path="/globe" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
            <ConfirmHost />
          </BrowserRouter>
          </TypographyProvider>
          </ProviderProvider>
        </LocationProvider>
      </ConnectivityProvider>
    </AuthProvider>
  );
}
