const vscode = require("vscode")
const fs = require("fs")
const path = require("path")
const { homedir } = require("os")
const Twitter = require("twitter")

const writeSerializedBlobToFile = (serializeBlob, fileName) => {
  const bytes = new Uint8Array(serializeBlob.split(','))
  fs.writeFileSync(fileName, Buffer.from(bytes))
}

const checkIfKeyIsNoSet = (key) => {return key === undefined || key === ''}
const credentialArray = [
  vscode.workspace.getConfiguration().get("twitter.consumerKey"),
  vscode.workspace.getConfiguration().get("twitter.consumerSecret"),
  vscode.workspace.getConfiguration().get("twitter.accessTokenKey"),
  vscode.workspace.getConfiguration().get("twitter.accessTokenSecret"),
]

const P_TITLE = 'Polacode 📸'

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const htmlPath = path.resolve(context.extensionPath, 'webview/index.html')

  let lastUsedImageUri = vscode.Uri.file(path.resolve(homedir(), 'Desktop/code.png'))
  let panel

  checkIfKeyIsNoSet(credentialArray)

  if (credentialArray.every(checkIfKeyIsNoSet)) {
    vscode.window.showErrorMessage(
      `Polacode-Twitter / Your Twitter credentials don't seem to have been entered. Please follow the extension's README to set it.`
    )
  }

  const client = new Twitter({
    consumer_key: credentialArray[0],
    consumer_secret: credentialArray[1],
    access_token_key: credentialArray[2],
    access_token_secret: credentialArray[3]
  })

  vscode.window.registerWebviewPanelSerializer('polacode', {
    async deserializeWebviewPanel(_panel, state) {
      panel = _panel
      panel.webview.html = getHtmlContent(htmlPath)
      panel.webview.postMessage({
        type: 'restore',
        innerHTML: state.innerHTML,
        bgColor: context.globalState.get('polacode.bgColor', '#2e3440')
      })
      const selectionListener = setupSelectionSync()
      panel.onDidDispose(() => {
        selectionListener.dispose()
      })
      setupMessageListeners()
    }
  })

  vscode.commands.registerCommand('polacode.activate', () => {
    panel = vscode.window.createWebviewPanel('polacode', P_TITLE, 2, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview'))]
    })

    panel.webview.html = getHtmlContent(htmlPath)

    const selectionListener = setupSelectionSync()
    panel.onDidDispose(() => {
      selectionListener.dispose()
    })

    setupMessageListeners()

    const fontFamily = vscode.workspace.getConfiguration('editor').fontFamily
    const bgColor = context.globalState.get('polacode.bgColor', '#2e3440')
    panel.webview.postMessage({
      type: 'init',
      fontFamily,
      bgColor
    })

    syncSettings()
  })

  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('polacode') || e.affectsConfiguration('editor')) {
      syncSettings()
    }
  })

  function setupMessageListeners() {
    panel.webview.onDidReceiveMessage(({ type, data }) => {
      switch (type) {
        case 'shoot':
          vscode.window
            .showSaveDialog({
              defaultUri: lastUsedImageUri,
              filters: {
                Images: ['png']
              }
            })
            .then(uri => {
              if (uri) {
                writeSerializedBlobToFile(data.serializedBlob, uri.fsPath)
                lastUsedImageUri = uri
              }
            })
          break
        case 'getAndUpdateCacheAndSettings':
          panel.webview.postMessage({
            type: 'restoreBgColor',
            bgColor: context.globalState.get('polacode.bgColor', '#2e3440')
          })

          syncSettings()
          break
        case 'updateBgColor':
          context.globalState.update('polacode.bgColor', data.bgColor)
          break
        case 'invalidPasteContent':
          vscode.window.showInformationMessage(
            "Pasted content is invalid. Only copy from VS Code and check if your shortcuts for copy/paste have conflicts."
          )
          break
        case "tweet":
          const bytes = new Uint8Array(data.serializedBlob.split(","))
          getClient().post(
            "media/upload",
            { media: Buffer.from(bytes) },
            function(err, media) {
              if (!err) {
                vscode.window
                  .showInputBox({
                    prompt: "Enter the content of your tweet.",
                  })
                  .then((value) => {
                    if (value !== undefined) {
                      const status = {
                        status: value,
                        media_ids: media.media_id_string,
                      }
                      sendTweet(status)
                    }
                  })
              } else {
                vscode.showErrorMessage("Sorry, failed to upload the image.")
              }
            }
          )
          break
      }
    })
  }

  function syncSettings() {
    const settings = vscode.workspace.getConfiguration('polacode')
    const editorSettings = vscode.workspace.getConfiguration('editor', null)
    panel.webview.postMessage({
      type: 'updateSettings',
      shadow: settings.get('shadow'),
      transparentBackground: settings.get('transparentBackground'),
      backgroundColor: settings.get('backgroundColor'),
      target: settings.get('target'),
      ligature: editorSettings.get('fontLigatures')
    })
  }

  function setupSelectionSync() {
    return vscode.window.onDidChangeTextEditorSelection(e => {
      if (e.selections[0] && !e.selections[0].isEmpty) {
        vscode.commands.executeCommand('editor.action.clipboardCopyWithSyntaxHighlightingAction')
        panel.postMessage({
          type: 'update'
        })
      }
    })
  }
}

function getHtmlContent(htmlPath) {
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8')
  return htmlContent.replace(/script src="([^"]*)"/g, (match, src) => {
    const realSource = 'vscode-resource:' + path.resolve(htmlPath, '..', src)
    return `script src="${realSource}"`
  })
}

function sendTweet(status) {
  getClient().post("statuses/update", status, function(err) {
    if (!err) {
      vscode.showInformationMessage("The tweet has been sent!")
    } else {
      vscode.showErrorMessage("Sorry, the tweet failed to send.")
    }
  })
}

function getClient() {
  const credentialArray = [
    vscode.workspace.getConfiguration().get("twitter.consumerKey"),
    vscode.workspace.getConfiguration().get("twitter.consumerSecret"),
    vscode.workspace.getConfiguration().get("twitter.accessTokenKey"),
    vscode.workspace.getConfiguration().get("twitter.accessTokenSecret"),
  ]

  if (!checkIfKeyIsNoSet(credentialArray)) {
    return new Twitter({
      consumer_key: credentialArray[0],
      consumer_secret: credentialArray[1],
      access_token_key: credentialArray[2],
      access_token_secret: credentialArray[3],
    })
  } else {
    return
  }
}

function checkIfKeyIsNoSet(credentialArray) {
  if (
    credentialArray.every((key) => {
      return key === undefined || key === ""
    })
  ) {
    vscode.window.showErrorMessage(
      `Your Twitter credentials don't seem to have been entered. Please follow the extension's README to set it.`
    )
    return true
  } else {
    return false
  }
}

exports.activate = activate
