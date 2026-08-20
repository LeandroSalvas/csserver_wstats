(function () {
  var track = document.getElementById('connectTrack')
  var prevBtn = document.getElementById('connectPrev')
  var nextBtn = document.getElementById('connectNext')
  if (!track || !prevBtn || !nextBtn) return

  var count = track.children.length

  function getCardWidth() {
    if (count === 0) return 0
    return track.scrollWidth / count
  }

  function getCurrentIndex() {
    var cardWidth = getCardWidth()
    if (!cardWidth) return 0
    return Math.round(track.scrollLeft / cardWidth)
  }

  function updateButtons() {
    var idx = getCurrentIndex()
    prevBtn.disabled = idx <= 0
    nextBtn.disabled = idx >= count - 1
  }

  prevBtn.addEventListener('click', function () {
    var idx = getCurrentIndex()
    if (idx > 0) {
      track.scrollTo({ left: (idx - 1) * getCardWidth(), behavior: 'smooth' })
    }
  })

  nextBtn.addEventListener('click', function () {
    var idx = getCurrentIndex()
    if (idx < count - 1) {
      track.scrollTo({ left: (idx + 1) * getCardWidth(), behavior: 'smooth' })
    }
  })

  track.addEventListener('scroll', updateButtons, { passive: true })
  updateButtons()
})()
