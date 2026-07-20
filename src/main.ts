import { mount } from 'svelte'
import App from './App.svelte'
import { paintFromHint } from '$lib/theme/paint-hint'
import '$lib/i18n/config'

paintFromHint()

const app = mount(App, { target: document.getElementById('app')! })
export default app
