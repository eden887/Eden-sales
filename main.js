// main.js

document.addEventListener("DOMContentLoaded", function () {
  console.log("main.js loaded successfully!");

  // Example: Add a click handler to a button with id="submitBtn"
  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) {
    submitBtn.addEventListener("click", function () {
      alert("Submit button clicked!");
    });
  }
});
