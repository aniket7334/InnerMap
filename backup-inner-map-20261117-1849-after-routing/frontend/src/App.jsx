import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/AuthContext';
import { ConnectivityProvider } from './hooks/ConnectivityContext';
import { LocationProvider } from './hooks/LocationContext';
import { ProviderProvider } from './hooks/ProviderContext';
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
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <AuthProvider>
      <ConnectivityProvider>
        <LocationProvider>
          <ProviderProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<PublicLayout />}>
                <Route path="/" element={<LandingPage />} />
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
                <Route path="/globe" element={<GlobeLoader />} />
                <Route path="/profile" element={<ProfilePage />} />
              </Route>
              <Route path="/home" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
          </ProviderProvider>
        </LocationProvider>
      </ConnectivityProvider>
    </AuthProvider>
  );
}
