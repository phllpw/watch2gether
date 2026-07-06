// Google Drive Integration Utilities (Phase 2)

const getGapi = () => (window as any).gapi;
const getGoogle = () => (window as any).google;

let gapiLoaded = false;
let gisLoaded = false;

// Dynamically load Google API and Google Identity Services scripts
export function loadGoogleApis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (gapiLoaded && gisLoaded) {
      resolve();
      return;
    }

    let scriptsToLoad = 2;
    const checkResolve = () => {
      scriptsToLoad--;
      if (scriptsToLoad === 0) {
        gapiLoaded = true;
        gisLoaded = true;
        resolve();
      }
    };

    const windowAny = window as any;

    // 1. Load GAPI (Google API client)
    if (typeof windowAny.gapi === 'undefined') {
      const gapiScript = document.createElement('script');
      gapiScript.src = 'https://apis.google.com/js/api.js';
      gapiScript.async = true;
      gapiScript.defer = true;
      gapiScript.onload = () => {
        windowAny.gapi.load('client:picker', checkResolve);
      };
      gapiScript.onerror = () => reject(new Error("Erro ao carregar gapi script"));
      document.body.appendChild(gapiScript);
    } else {
      windowAny.gapi.load('client:picker', checkResolve);
    }

    // 2. Load GIS (Google Identity Services)
    if (typeof windowAny.google === 'undefined' || typeof windowAny.google.accounts === 'undefined') {
      const gisScript = document.createElement('script');
      gisScript.src = 'https://accounts.google.com/gsi/client';
      gisScript.async = true;
      gisScript.defer = true;
      gisScript.onload = checkResolve;
      gisScript.onerror = () => reject(new Error("Erro ao carregar GIS script"));
      document.body.appendChild(gisScript);
    } else {
      checkResolve();
    }
  });
}

// Request Access Token using Google Identity Services (initTokenClient)
export function requestDriveToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const googleObj = getGoogle();
    if (typeof googleObj === 'undefined' || !googleObj.accounts || !googleObj.accounts.oauth2) {
      reject(new Error("Google Identity Services não está carregado."));
      return;
    }

    try {
      const tokenClient = googleObj.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (response: any) => {
          if (response.error !== undefined) {
            reject(response);
          } else if (response.access_token) {
            resolve(response.access_token);
          } else {
            reject(new Error("Resposta do OAuth não retornou o token de acesso."));
          }
        },
      });

      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
      reject(err);
    }
  });
}

interface PickerConfig {
  apiKey: string;
  appId: string;
  token: string;
  onSelect: (file: { id: string; name: string; mimeType: string; embedUrl: string }) => void;
  onCancel?: () => void;
}

// Open Google Picker with Google App ID and video mimeTypes filter
export function openDrivePicker({ apiKey, appId, token, onSelect, onCancel }: PickerConfig) {
  const googleObj = getGoogle();
  const gapiObj = getGapi();
  if (typeof googleObj === 'undefined' || typeof gapiObj === 'undefined' || !gapiObj.picker) {
    console.error("Google Picker APIs não carregadas.");
    return;
  }

  try {
    const view = new googleObj.picker.View(googleObj.picker.ViewId.DOCS);
    // Filter for video types only
    view.setMimeTypes('video/mp4,video/webm,video/quicktime,video/x-matroska');

    const picker = new googleObj.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setCallback((data: any) => {
        if (data.action === googleObj.picker.Action.PICKED) {
          const fileDoc = data.docs[0];
          onSelect({
            id: fileDoc.id,
            name: fileDoc.name,
            mimeType: fileDoc.mimeType,
            embedUrl: fileDoc.embedUrl
          });
        } else if (data.action === googleObj.picker.Action.CANCEL) {
          if (onCancel) onCancel();
        }
      })
      .build();

    picker.setVisible(true);
  } catch (err) {
    console.error("Erro ao construir Picker:", err);
  }
}

// Generate the direct streaming URL via Drive API files.get + alt=media
export function getDriveFileDirectUrl(fileId: string, accessToken: string): string {
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&access_token=${accessToken}`;
}
