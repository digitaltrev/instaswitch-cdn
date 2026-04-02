document.getElementById('raf-share-btn').addEventListener('click', function(e) {
  e.preventDefault();
  var msg = "Open an account at FirstBank and we'll both earn $50! Click here: https://open.garden-fi.com/workflow";
  if (navigator.share) {
    navigator.share({ text: msg });
  } else {
    navigator.clipboard.writeText(msg);
    alert('Link copied!');
  }
});
