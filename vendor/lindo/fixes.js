/* Touches fix */

/**
 * @param {Record<string, { title: string, messages: string[] }>} texts
 * @param {{ url: string, text: string }} link
 */
async function sendPopup(texts, link) {
  const languagesInitialized = new Promise(resolve => {
    const interval = setInterval(() => {
      if (window.Config && window.Config.language) {
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });

  const lindoLogoLoaded = new Promise(resolve => {
    const lindoLogo = new Image();
    lindoLogo.addEventListener('load', resolve);
    lindoLogo.src = "https://lindo-app.com/icon.png";
  });

  await Promise.all([
    languagesInitialized,
    lindoLogoLoaded
  ]);

  const translatedTexts = texts[window.Config.language] || texts['en'] || texts[Object.keys(texts)[0]];

  window.gui.openSimplePopup(`
    <div>
      ${translatedTexts.messages.join('<br />')}<br />
      <a target="_blank" href="${link.url}" style="text-align: center; font-size: 1.2em; display: inline-block; width: 100%; margin-top: 0.4em; text-decoration: none;">
        <img src="https://lindo-app.com/icon.png" style="height: 1.2em; display: inline-block; vertical-align: middle;"/>
        <span style="vertical-align: middle;">${link.text}</span>
      </a>
    </div>
  `, translatedTexts.title);

  return translatedTexts
}

var events = {
  "mousedown": "touchstart",
  "mouseup": "touchend",
  "mousemove": "touchmove"
};

var mouseDown = false;

var handleEvents = function (e) {
  try {
    if (e.type === "mousedown") mouseDown = true;
    else if (e.type === "mouseup") mouseDown = false;

    if (!mouseDown && e.type === "mousemove") return;

    const touchObj = new Touch({
      identifier: 0,
      target: e.target,
      clientX: e.clientX,
      clientY: e.clientY,
      pageX: e.pageX,
      pageY: e.pageY,
      screenX: e.screenX,
      screenY: e.screenY,
      radiusX: 11.5,
      radiusY: 11.5,
      rotationAngle: 0,
      force: e.type === "mouseup" ? 0 : 1,
    });

    const touchEvent = new TouchEvent(events[e.type], {
      cancelable: true,
      bubbles: true,
      touches: e.type === "mouseup" ? [] : [touchObj],
      targetTouches: e.type === "mouseup" ? [] : [touchObj],
      changedTouches: [touchObj],
      shiftKey: false,
      composed: true,
      isTrusted: true,
      sourceCapabilities: new InputDeviceCapabilities({ firesTouchEvents: true }),
      view: window
    });

    e.target.dispatchEvent(touchEvent);
  } catch (e) {
    top.console.log(e);
  }

  e.stopPropagation();
  // e.preventDefault();
  return false;
};

try {
  for (var id in events) {
    document.body.addEventListener(id, handleEvents, true);
  }
} catch (e) {
  top.console.log(e);
}

/* Popups */

(function () {
  // New website notification
  if (!window.top.lindoVersion) { // Lindo <= 2.5.2 does not have lindoVersion
    const lastAsked = window.localStorage.getItem('lindo-update-popup');
    if (!lastAsked || Date.now() > parseInt(lastAsked) + 1000 * 60 * 60 * 24 * 7) { // 1 week
      window.localStorage.setItem('lindo-update-popup', Date.now())

      const texts = {
        fr: {
          title: `Notification de Lindo`,
          messages: [
            `Salut ! Désolé pour l'intrusion.`,
            `Le site officiel de Lindo a changé d'adresse. On ne pourra plus te prévenir en cas de nouvelle mise à jour avec la version sur laquelle tu joues. Tu peux corriger ça en téléchargeant la dernière version depuis notre nouvelle adresse :`
          ]
        },
        en: {
          title: `Notification from Lindo`,
          messages: [
            `Hi! Sorry for the intrusion.`,
            `Lindo official website address has changed. We will no longer be able to notify you about upcoming releases of Lindo with the version you're currently playing. You can fix this by downloading the latest version from our new address:`
          ]
        },
        es: {
          title: `Notificación de Lindo`,
          messages: [
            `¡Hola! Perdón por la intrusión.`,
            `La dirección del sitio web oficial de Lindo ha cambiado. Ya no podremos notificarle sobre los próximos lanzamientos de Lindo con la versión en la que está jugando actualmente. Puede solucionar este problema descargando la última versión desde nuestra nueva dirección:`
          ]
        }
      }

      const link = {
        url: 'https://lindo-app.com',
        text: 'lindo-app.com'
      }

      sendPopup(texts, link)
      return
    }
  }

  if (!window.localStorage.getItem('lindo-reddit-popup')) {
    window.localStorage.setItem('lindo-reddit-popup', true)

    const texts = {
      fr: {
        title: `Notification de Lindo`,
        messages: [
          `Le Discord de Lindo a fermé. Tu peux désormais nous retrouver sur Reddit.<br />`
        ]
      },
      en: {
        title: `Notification from Lindo`,
        messages: [
          `The Discord of Lindo has been shut down. You can now find us on Reddit.<br />`
        ]
      },
      es: {
        title: `Notificación de Lindo`,
        messages: [
          `El Discord de Lindo ha sido cerrado. Ahora puedes encontrarnos en Reddit.<br /> `
        ]
      }
    }

    const link = {
      url: 'https://www.reddit.com/r/LindoApp/comments/t7auy1/ouverture_du_subreddit/',
      text: 'Subreddit de Lindo'
    }

    sendPopup(texts, link)
    return
  }

  const lastAskedMatrix = window.localStorage.getItem('lindo-matrix-popup');
  if (!lastAskedMatrix || Date.now() > parseInt(lastAskedMatrix) + 1000 * 60 * 60 * 24 * 7) { // 1 week
    window.localStorage.setItem('lindo-matrix-popup', Date.now())

    const texts = {
      fr: {
        title: `Notification de Lindo`,
        messages: [
          `Un nouveau serveur de discussion a été mis en place pour remplacer Discord ! Retrouve nous vite sur le serveur Matrix de Lindo<br />`
        ]
      },
      en: {
        title: `Notification from Lindo`,
        messages: [
          `A new chat server has been set up to replace Discord! Find us quickly on Lindo's Matrix server.<br />`
        ]
      },
      es: {
        title: `Notificación de Lindo`,
        messages: [
          `¡Se ha configurado un nuevo servidor de chat para reemplazar a Discord! Encuéntrenos rápidamente en el servidor Matrix de Lindo.<br /> `
        ]
      }
    }

    const link = {
      url: 'https://matrix.to/#/#lindo-official:matrix.org',
      text: 'Matrix Lindo'
    }

    sendPopup(texts, link)
    return
  }
})();
