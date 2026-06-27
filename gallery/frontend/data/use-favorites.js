import useSWR from 'swr'

import { albumTags, tag as patchTag } from '../lib/api'
import { imageRef } from '../lib/image-ref'

// Favorite state for an album, fetched separately from the sprite manifest (tag
// changes must reflect immediately, without an album rebuild). Optimistic toggle
// that reverts on failure.
export const useFavorites = (album) => {
  const { data, mutate } = useSWR(
    album ? ['album_favorites', album] : null,
    () => albumTags(album, 'favorite')
  )
  const favorites = data || []
  const favSet = new Set(favorites)

  const isFavorite = (image) => favSet.has(image)

  const toggle = async (image, next) => {
    const optimistic = next
      ? [...new Set([...favorites, image])]
      : favorites.filter((f) => f !== image)
    mutate(optimistic, { revalidate: false })
    // The image-data PATCH replaces the image's tag set; 'favorite' is the only
    // tag the UI manages, so [] clears it and ['favorite'] sets it.
    const ret = await patchTag({ album, image, tags: next ? ['favorite'] : [] })
    if (ret == null) {
      mutate(favorites, { revalidate: false }) // revert
      return false
    }
    mutate() // revalidate from server
    return true
  }

  return { favorites, favSet, isFavorite, toggle, mutate }
}

const EMPTY_SET = new Set()

// Favorite state across MANY albums, keyed by the full doc `path`. The search
// and map lightboxes show results spanning albums, so (unlike useFavorites,
// which binds to a single album) this takes the result docs, fetches each
// distinct album's favorites once, and unions them into one Set. Optimistic
// toggle that reverts on failure.
export const useFavoritesMulti = (docs) => {
  const albums = [...new Set((docs || []).map((d) => d.album).filter(Boolean))].sort()
  const { data, mutate } = useSWR(
    albums.length ? ['favorites_multi', albums.join('\n')] : null,
    async () => {
      const lists = await Promise.all(
        albums.map(async (a) =>
          (await albumTags(a, 'favorite')).map((img) => `${a}/${img}`)
        )
      )
      return new Set(lists.flat())
    }
  )
  const favSet = data || EMPTY_SET

  const isFavorite = (doc) => favSet.has(doc.path)

  const toggle = async (doc, next) => {
    const ref = imageRef(doc)
    if (!ref) return false
    const optimistic = new Set(favSet)
    if (next) optimistic.add(doc.path)
    else optimistic.delete(doc.path)
    mutate(optimistic, { revalidate: false })
    const ret = await patchTag({ ...ref, tags: next ? ['favorite'] : [] })
    if (ret == null) {
      mutate(favSet, { revalidate: false }) // revert
      return false
    }
    mutate() // revalidate from server
    return true
  }

  return { favSet, isFavorite, toggle, mutate }
}
