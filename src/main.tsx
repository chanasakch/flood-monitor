import { render } from 'preact';
import '@fontsource/ibm-plex-sans-thai/thai-400.css';
import '@fontsource/ibm-plex-sans-thai/thai-600.css';
import '@fontsource/ibm-plex-sans-thai/latin-400.css';
import '@fontsource/ibm-plex-sans-thai/latin-600.css';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './app';

render(<App />, document.getElementById('app')!);
