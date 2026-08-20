(function () {
  var track = document.getElementById('modesTrack')
  var dots = document.getElementById('modesDots')
  if (!track || !dots) return

  var spans = dots.querySelectorAll('span')
  var count = track.children.length

  function getVisibleCount() {
    if (window.innerWidth >= 901) return count
    if (window.innerWidth >= 601) return 2
    return 1
  }

  function updateDots() {
    var visible = getVisibleCount()
    var cardWidth = track.scrollWidth / count
    var idx = Math.round(track.scrollLeft / cardWidth)
    for (var i = 0; i < spans.length; i++) {
      spans[i].classList.toggle('active', i === idx)
    }
  }

  track.addEventListener('scroll', updateDots, { passive: true })

  for (var i = 0; i < spans.length; i++) {
    ;(function (idx) {
      spans[idx].addEventListener('click', function () {
        var visible = getVisibleCount()
        if (visible >= count) return
        var cardWidth = track.scrollWidth / count
        track.scrollTo({ left: idx * cardWidth, behavior: 'smooth' })
      })
    })(i)
  }
})()
