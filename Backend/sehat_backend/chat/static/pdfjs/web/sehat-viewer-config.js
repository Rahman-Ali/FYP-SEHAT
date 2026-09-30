// SEHAT settings for the bundled pdf.js viewer (loaded before viewer.mjs).
// Read-only viewing: no PDF scripting, no editing, no saved preferences, no navigation
// to links inside the PDF (the app must never open external sites).
document.addEventListener("webviewerloaded", function () {
  var options = window.PDFViewerApplicationOptions;
  var set = function (name, value) {
    try {
      options.set(name, value);
    } catch (e) {
      // option not present in this pdf.js version
    }
  };
  set("disablePreferences", true);
  set("enableScripting", false);
  set("annotationEditorMode", -1); // AnnotationEditorType.DISABLE
  set("enableSignatureEditor", false);
  set("enableComment", false);
  set("disableHistory", true);
  set("sidebarViewOnLoad", 0);

  window.PDFViewerApplication.initializedPromise.then(function () {
    window.PDFViewerApplication.pdfLinkService.externalLinkEnabled = false;
  });
});
