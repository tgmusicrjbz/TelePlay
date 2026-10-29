import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const task = process.argv[2];
if (!task) throw new Error('Gradle task is required.');
if (/release/i.test(task)) {
    const required = ['KOMOD_RELEASE_STORE_FILE', 'KOMOD_RELEASE_STORE_PASSWORD', 'KOMOD_RELEASE_KEY_ALIAS', 'KOMOD_RELEASE_KEY_PASSWORD'];
    const missing = required.filter(name => !process.env[name]);
    if (missing.length) throw new Error(`Release signing variables are missing: ${missing.join(', ')}`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'android');
const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const args = [task];
if (process.env.ANDROID_MAVEN_MIRROR) {
    args.push('--init-script', path.join('..', 'gradle', 'android-mirror.init.gradle'));
}
const env = { ...process.env };
if (!env.ANDROID_HOME && process.platform === 'win32' && env.LOCALAPPDATA) {
    env.ANDROID_HOME = path.join(env.LOCALAPPDATA, 'Android', 'Sdk');
}
const result = spawnSync(wrapper, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
