// Vote option selection highlight
document.querySelectorAll('.vote-option input[type=radio]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.vote-option-box').forEach(box => box.classList.remove('selected'));
    if (radio.checked) radio.closest('.vote-option').querySelector('.vote-option-box').classList.add('selected');
  });
});
