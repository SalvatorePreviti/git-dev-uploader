# git-dev-uploader


Asynchronous js loading

```javascript
fetch('https://salvatorepreviti.github.io/git-dev-uploader/docs/yourfile.js')
  .then(response => response.text())
  .then(code => eval(code));

```

Synchronous js loading

```javascript
// Synchronous XHR (deprecated, blocks UI, but works in some browsers)
var xhr = new XMLHttpRequest();
xhr.open('GET', 'https://salvatorepreviti.github.io/git-dev-uploader/docs/yourfile.js', false);
xhr.send(null);
if (xhr.status === 200) {
  eval(xhr.responseText);
} else {
  throw new Error('Failed to load script: ' + xhr.status + ' ' + xhr.statusText);
}
```