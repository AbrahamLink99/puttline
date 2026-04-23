const btnStart = document.getElementById('btn-start');

btnStart.addEventListener('click', () => {
  btnStart.textContent = 'Coming soon';
  btnStart.disabled = true;
});
