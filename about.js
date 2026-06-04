document.addEventListener('DOMContentLoaded', () => {
    const manifest = chrome.runtime.getManifest();

    document.getElementById('ext-version').textContent = manifest.version;
    return;

    document.title = `About - ${manifest.name}`;

    document.getElementById('ext-name').textContent = manifest.name;
    document.getElementById('ext-desc').textContent = manifest.description || "";
});
