import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Nav } from './components/Nav';
import { CatchScreen } from './screens/CatchScreen';
import { PatternsScreen } from './screens/PatternsScreen';
import { ReadingScreen } from './screens/ReadingScreen';
import { DebriefScreen } from './screens/DebriefScreen';
import { LexiconScreen } from './screens/LexiconScreen';
import { initTelegram } from './lib/telegram';
import './App.css';

export default function App() {
  useEffect(() => { initTelegram(); }, []);

  return (
    <BrowserRouter>
      <div className="app">
        <main className="app__main">
          <Routes>
            <Route path="/" element={<CatchScreen />} />
            <Route path="/patterns" element={<PatternsScreen />} />
            <Route path="/reading" element={<ReadingScreen />} />
            <Route path="/debrief" element={<DebriefScreen />} />
            <Route path="/lexicon" element={<LexiconScreen />} />
          </Routes>
        </main>
        <Nav />
      </div>
    </BrowserRouter>
  );
}
