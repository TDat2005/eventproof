import {render} from 'preact';
import {LocationProvider, ErrorBoundary, Router, Route} from 'preact-iso';

import HomePage from './pages/HomePage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

export default async () => {
  render(<App />, document.body);
};

function App() {
  return (
    <LocationProvider>
      <ErrorBoundary>
        <Router>
          <Route path="/" component={HomePage} />
          <Route path="/analytics" component={AnalyticsPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route default component={NotFoundPage} />
        </Router>
      </ErrorBoundary>
    </LocationProvider>
  );
}
