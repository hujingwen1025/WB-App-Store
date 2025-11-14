(function() {
    'use strict';

    const appStoreIconTitle = document.getElementsByClassName("platform-selector-container")[0];

    window.appModifyActive = false
    window.currentAppInstalled = false
    window.installedApps = []

    function doViewReset() {
        try {
            if (!document.getElementById("traffic-light-indent")) {
                var trafficLightIndentDiv = document.createElement('div');
            }
            trafficLightIndentDiv.style = "height: 20px;"
            trafficLightIndentDiv.id = "traffic-light-indent"
            appStoreIconTitle.before(trafficLightIndentDiv);
        } catch (error) {
            
        }

        try {
            document.getElementsByClassName("svelte-1hs3qpl")[0].innerHTML = ""
        } catch (error) {}
    }

    function extractAppId(url) {
        const parts = url.split('/id');
        return parts[1]?.split('?')[0] || null;
    }
    
    function changeAppInstallSet() {
        if (!window.appModifyActive) {
            try {
                var appInstallButton = document.getElementsByClassName("get-button blue svelte-xi2f74")[0]
                appInstallButton.disabled = false
                if (window.currentAppInstalled) {
                    appInstallButton.innerHTML = "Uninstall"
                    appInstallButton.style = "background-color: #f7675a;"
                } else {
                    appInstallButton.innerHTML = "Install"
                    appInstallButton.style = ""
                }
            } catch (error) {}
        }
    }

    function displayInstallingText() {
        window.appModifyActive = true
        try {
            localStorage.setItem('currentAppModify', String(extractAppId(window.location.href)))
            localStorage.setItem('currentAppModifyAction', "install")
            var appInstallButton = document.getElementsByClassName("get-button blue svelte-xi2f74")[0]
            appInstallButton.innerHTML = "Installing"
            appInstallButton.disabled = true
        } catch (error) {}
    }

    function displayUninstallingText() {
        window.appModifyActive = true
        try {
            localStorage.setItem('currentAppModify', String(extractAppId(window.location.href)))
            localStorage.setItem('currentAppModifyAction', "uninstall")
            var appInstallButton = document.getElementsByClassName("get-button blue svelte-xi2f74")[0]
            appInstallButton.innerHTML = "Uninstalling"
            appInstallButton.disabled = true
        } catch (error) {}
    }

    function firstLaunch() {
        localStorage.clear()
    }

    window.electronAPI.receiveMessage((data) => {
        switch (data) {
            case 'app-installing':
                displayInstallingText()
                break;
            case 'app-uninstalling':
                displayUninstallingText()
                break;
            case 'app-installed':
                window.appModifyActive = false
                break;
            case 'app-uninstalled':
                window.appModifyActive = false
                break;
            case 'first-launch':
                firstLaunch()
                break;
        }
    });

    window.electronAPI.installedMessage((data) => {
        loadInstalledStatus(data)
    })

    function loadInstalledStatus(data) {
        window.installedApps = data
    }

    function setInstalledStatus() {
        if (window.location.href.includes("/id") && window.location.href.includes("/app/")) {
            if (localStorage.getItem("currentAppModify") === String(extractAppId(window.location.href))) {
                if (localStorage.getItem("currentAppModifyAction") === "install") {
                    if (window.installedApps.includes(extractAppId(window.location.href))) {
                        window.currentAppInstalled = true
                        return
                    }
                    var appInstallButton = document.getElementsByClassName("get-button blue svelte-xi2f74")[0]
                    appInstallButton.innerHTML = "Installing"
                    appInstallButton.disabled = true
                } else if (localStorage.getItem("currentAppModifyAction") === "uninstall") {
                    if (!window.installedApps.includes(extractAppId(window.location.href))) {
                        window.currentAppInstalled = false
                        return
                    }
                    var appInstallButton = document.getElementsByClassName("get-button blue svelte-xi2f74")[0]
                    appInstallButton.innerHTML = "Uninstalling"
                    appInstallButton.disabled = true
                    appInstallButton.style = "background-color: #f7675a;"
                } else {
                    var appInstallButton = document.getElementsByClassName("get-button blue svelte-xi2f74")[0]
                    appInstallButton.innerHTML = "Install"
                    appInstallButton.disabled = false
                }
            } else {
                if (window.installedApps.includes(extractAppId(window.location.href))) {
                    window.currentAppInstalled = true
                } else {
                    window.currentAppInstalled = false
                }
            }
        }
    }

    function ensureMacVersion() {
        if (window.location.href.includes("/iphone/") || window.location.href.includes("/ipad/") || window.location.href.includes("/vision/") || window.location.href.includes("/watch/") || window.location.href.includes("/tv/")) {
            window.location.href = window.location.href.replace("/iphone/", "/mac/").replace("/ipad/", "/mac/").replace("/vision/", "/mac/").replace("/watch/", "/mac/").replace("/tv/", "/mac/")
        }
    }

    async function repeatProcess() {
        doViewReset()
        changeAppInstallSet()
        setInstalledStatus()
        ensureMacVersion()
    }

    setInterval(() => {
        repeatProcess()
    }, 175);
})();