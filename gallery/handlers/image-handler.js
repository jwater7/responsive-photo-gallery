// vim: tabstop=2 shiftwidth=2 expandtab
//

'use strict'

const fs = require('fs')
const path = require('path')
const Promise = require('bluebird')
const sanitize = require('sanitize-filename')
const { mkdirp } = require('mkdirp')

const imageProcessing = require('fast-image-processing')

const runtimeConfig = require('rpg-config')

const debug = require('debug')('responsive-photo-gallery:image-handler')
const debugErr = require('debug')(
  'responsive-photo-gallery:image-handler:error'
)
debugErr.enabled = true // errors are always-on, not gated by DEBUG

// Alternative to sanitize for paths: the shared containment primitive
// (identical contract to the local implementation it replaces).
const { resolveWithin: sanitizeToRoot } = require('rpg-path-safety')

// Video thumbs cache under video-thumbs/ (fip appends an image extension to
// the dest). Selected by the shared registry predicate — the old '.mov'-only
// extension test mislocated .mp4/.m4v/.webm thumbs under thumbs/.
// walkMedia replaces the old local sync walker, which ignored the admin
// exclude list — /list and /thumbnails kept serving excluded subtrees that
// every other plane (albums, search, enrichment) already hid.
const { isVideo, walkMedia } = require('rpg-media-types')

// Album-relative media files for /list & /thumbnails, honoring admin excludes.
// The exclude list is IMAGE_PATH-relative, so prefix the album onto the
// walker's album-relative dir paths (same as album-build's scan).
const listAlbumFiles = async (albumPath, album) => {
  const excludes = await runtimeConfig.getExcludes()
  const files = await walkMedia(albumPath, {
    shouldSkipDir: (rel) =>
      runtimeConfig.isExcluded(`${album}/${rel}`, excludes),
  })
  return files.map((f) => f.rel)
}

const getThumbBuffer = (image_path, thumb_path, thumb, _cb) => {
  const [width, height] = thumb.split('x')

  // make sure we have valid input
  const san_width = parseInt(width)
  const san_height = parseInt(height)
  if (+width !== san_width || +height !== san_height) {
    return _cb(new Error('Invalid Dimensions'), undefined, undefined)
  }

  return imageProcessing.cacheThumbAndGetBuffer(
    image_path,
    thumb_path,
    san_width,
    san_height,
    (err, thumb_buffer, thumb_content_type) => {
      if (err) {
        return _cb(err, undefined, undefined)
      }

      return _cb(undefined, thumb_buffer, thumb_content_type)
    }
  )
}

const getImageBuffer = (image_path, _cb) => {
  return imageProcessing.getNormalizedImageBuffer(
    image_path,
    (err, image_buffer, image_content_type) => {
      if (err) {
        return _cb(err, undefined, undefined)
      }

      return _cb(undefined, image_buffer, image_content_type)
    }
  )
}

const sanitizeRequiredArguments = (args, _cb) => {
  var san_args = []
  for (let i = 0; i < args.length; i++) {
    // Required arguments
    if (!args[i]) {
      return _cb(new Error('missing required argument'), undefined)
    }
    const san_arg = sanitize(args[i])
    if (!san_arg) {
      return _cb(new Error('malformed argument'), undefined)
    }
    san_args.push(san_arg)
  }

  return _cb(undefined, san_args)
}

// Resolve a caller-supplied (album, image) pair to an absolute path under the
// image root, or null when it must be refused.
//
// The two arguments have DIFFERENT shapes and need different handling:
//
//   `album` is exactly one directory component (the gallery's albums() is a
//   top-level readdir), so filename-sanitizing it is correct.
//
//   `image` is a RELATIVE PATH. Camera imports nest ("102APPLE/IMG_2354.JPG"),
//   the enrichment indexer walks recursively, and lib/image-ref.js documents
//   multi-level image paths. Filename-sanitizing it STRIPS the separators, which
//   both breaks every nested image (the flattened name doesn't exist -> 500) and
//   silently REWRITES near-miss names onto other real files (`flat.jpg"` ->
//   `flat.jpg`). A sanitizer that mutates a path into a different valid path is
//   the wrong tool; containment is.
//
// Containment is therefore applied in two steps, and the second step is the one
// that matters: confining `image` to the ALBUM, not merely to the image root. A
// single resolveWithin against the root would accept "/../other-album/x.jpg" —
// path.join eats the album component, leaving a path that is still inside the
// root but no longer inside the requested album. That would quietly make the
// `album` argument non-authoritative.
const resolveAlbumImage = (imageRoot, album, image) => {
  // Non-string shapes (a duplicated query param arrives as an array) are caller
  // errors, not TypeErrors thrown deep in a callback chain.
  if (typeof album !== 'string' || typeof image !== 'string') return null
  if (!album || !image) return null

  const san_album = sanitize(album)
  if (!san_album) return null

  const album_dir = sanitizeToRoot(imageRoot, san_album)
  // Guard the empty rejection value: resolveWithin('', x) would resolve against
  // the process cwd, turning a rejected album into a live filesystem root.
  if (!album_dir) return null

  const image_path = sanitizeToRoot(album_dir, image)
  if (!image_path) return null
  // The album directory itself is not an image ("." / "/." / a trailing "..").
  if (image_path === album_dir) return null

  return { album: san_album, album_dir, image_path }
}

// Cache path for one thumbnail, confined the same way: the album's thumb
// directory first, then the image path within it. `image` may be nested, so the
// cache mirrors that nesting (fast-image-processing mkdirp's the parent).
const resolveThumbPath = (cacheRoot, album, kind, san_thumb, image) => {
  const dir = sanitizeToRoot(cacheRoot, path.join(album, kind, san_thumb))
  if (!dir) return ''
  return sanitizeToRoot(dir, image)
}

const sanitizeRequiredArgumentsAsync = (...a) =>
  new Promise((resolve, reject) =>
    sanitizeRequiredArguments(...a, (err, args) => {
      if (err) {
        return reject(err)
      }
      resolve(args)
    })
  )

// num_results must be a positive integer when supplied. Returns the parsed
// value, or null for anything else — the callers turn null into a 400 (the old
// behavior fed the raw value straight to limitResults, which silently returned
// [] and surfaced downstream as a misleading 500 "No Images Processed").
const sanitizeNumResults = (num_results) => {
  const n = parseInt(num_results, 10)
  return +num_results === n && n > 0 ? n : null
}

const limitResults = (list, num_results, distributed) => {
  // sanitize input
  // make sure we have valid input
  const san_num_results = parseInt(num_results)
  if (+num_results !== san_num_results) {
    return []
  }
  const san_distributed = distributed === 'true'

  // return a first chunk if not distributing results
  if (!san_distributed) {
    return list.slice(0, san_num_results)
  }

  let ret_list = []
  if (san_num_results) {
    const delta =
      san_num_results >= list.length
        ? 1
        : Math.floor(list.length / san_num_results)
    if (delta) {
      for (
        let i = 0;
        i < list.length && ret_list.length < san_num_results;
        i = i + delta
      ) {
        //debug(i, delta, san_num_results, list.length);
        ret_list.push(list[i])
      }
    }
  }
  return ret_list
}

class imageHandler {
  // `cachePath` is the album build-cache root (CACHE_PATH). Thumbnails are
  // written as a per-album artifact under it, alongside the sprite sheets:
  //   <cachePath>/<album>/thumbs/<size>/<image>   (videos under thumbs/video/).
  constructor(imagePath, cachePath = false, tagsPath = false) {
    this.imagePath = imagePath
    this.cachePath = cachePath
    this.tagsPath = tagsPath
  }

  image(album, image, thumb, _cb) {
    // A refused path is a CALLER error (400), not a server failure (500):
    // reporting it as 500 both misleads monitoring and makes a rejected path
    // indistinguishable from a genuine read error.
    const bad = (message) =>
      _cb({ error: { code: 400, message } }, undefined, undefined)

    const resolved = resolveAlbumImage(this.imagePath, album, image)
    if (!resolved) return bad('malformed or missing album/image argument')
    const { album: san_album, image_path } = resolved

    {
      // If they want a thumbnail, generate, cache, and return it instead
      if (thumb) {
        if (typeof thumb !== 'string') return bad('malformed thumb argument')
        const san_thumb = sanitize(thumb)
        if (!san_thumb) return bad('malformed thumb argument')
        const thumb_path = resolveThumbPath(
          this.cachePath,
          san_album,
          isVideo(image) ? 'video-thumbs' : 'thumbs',
          san_thumb,
          image
        )
        if (!thumb_path) return bad('malformed thumb argument')
        return getThumbBuffer(
          image_path,
          thumb_path,
          san_thumb,
          (err, thumb_buffer, thumb_content_type) => {
            if (err) {
              // return the original image if there is an error
              return getImageBuffer(
                image_path,
                (err, image_buffer, image_content_type) => {
                  if (err) {
                    return _cb(
                      {
                        error: {
                          code: 500,
                          message: 'Unable to get backup image',
                        },
                      },
                      undefined,
                      undefined
                    )
                  }
                  return _cb(undefined, image_buffer, image_content_type)
                }
              )
            }
            return _cb(undefined, thumb_buffer, thumb_content_type)
          }
        )
      }

      return getImageBuffer(
        image_path,
        (err, image_buffer, image_content_type) => {
          if (err) {
            return _cb(
              {
                error: {
                  code: 500,
                  message: 'Unable to get image',
                },
              },
              undefined,
              undefined
            )
          }
          return _cb(undefined, image_buffer, image_content_type)
        }
      )
    }
  }

  video(album, image, _cb) {
    // Same two-step containment as image(): videos live in the same album tree
    // and nest the same way (an iPhone import puts .MOV beside .JPG).
    const resolved = resolveAlbumImage(this.imagePath, album, image)
    if (!resolved) {
      return _cb(
        { error: { code: 400, message: 'malformed or missing album/image argument' } },
        undefined
      )
    }

    return _cb(undefined, resolved.image_path)
  }

  thumbnails(album, thumb, image, num_results, distributed, _cb) {
    sanitizeRequiredArguments([album, thumb], (err, args) => {
      if (err || !args) {
        return _cb({
          error: {
            code: 400,
            message: err.message,
          },
        })
      }
      const [album, thumb] = args

      let album_path = path.join(this.imagePath, album)

      // If they only want a single thumbnail, generate, cache, and return it instead
      if (image) {
        // Same two-step containment as image(): this route passed `image`
        // through UNSANITIZED, so it accepted "/../other-album/x.jpg" — inside
        // the image root, but outside the requested album.
        const resolved = resolveAlbumImage(this.imagePath, album, image)
        if (!resolved) {
          return _cb({
            error: { code: 400, message: 'malformed or missing album/image argument' },
          })
        }
        const image_path = resolved.image_path
        const san_thumb = sanitize(thumb)
        const thumb_path = resolveThumbPath(
          this.cachePath,
          resolved.album,
          isVideo(image) ? 'video-thumbs' : 'thumbs',
          san_thumb,
          image
        )
        if (!thumb_path) {
          return _cb({ error: { code: 400, message: 'malformed thumb argument' } })
        }
        return getThumbBuffer(
          image_path,
          thumb_path,
          san_thumb,
          (err, thumb_buffer, thumb_content_type) => {
            if (err) {
              debugErr(err)
              return _cb(
                {
                  error: {
                    code: 500,
                    message: 'Unable to get thumb image',
                  },
                },
                undefined,
                undefined
              )
            }
            let images = {}
            images[image] = {
              // TODO: these are not necessarily png files
              base64tag:
                'data:' +
                thumb_content_type +
                ';base64,' +
                thumb_buffer.toString('base64'),
            }
            return _cb({
              result: images,
            })
          }
        )
      }

      let images = {}
      Promise.resolve(listAlbumFiles(album_path, album)).then((files) => {
        // No files to loop on
        if (!files.length) {
          return _cb({
            error: {
              code: 500,
              message: 'No Files Processed',
            },
          })
        }

        // Process only a subset if requested
        if (num_results) {
          const n = sanitizeNumResults(num_results)
          if (n === null) {
            return _cb({
              error: { code: 400, message: 'Invalid num_results' },
            })
          }
          files = limitResults(files, n, distributed)
        }

        Promise.map(
          files,
          (file) => {
            const san_thumb = sanitize(thumb)
            const image_path = path.join(album_path, file)
            // `file` comes from listAlbumFiles (read off disk), not the caller,
            // but it is confined the same way so one code path governs where
            // thumbnails may be written.
            const thumb_path = resolveThumbPath(
              this.cachePath,
              album,
              isVideo(file) ? 'video-thumbs' : 'thumbs',
              san_thumb,
              file
            )
            return new Promise((resolve, reject) => {
              getThumbBuffer(
                image_path,
                thumb_path,
                san_thumb,
                (err, thumb_buffer, thumb_content_type) => {
                  if (err) {
                    debugErr(err)
                    return resolve()
                  }
                  images[file] = {
                    // TODO: these are not necessarily png files
                    base64tag:
                      'data:' +
                      thumb_content_type +
                      ';base64,' +
                      thumb_buffer.toString('base64'),
                  }
                  return resolve()
                }
              )
            })
          },
          { concurrency: 16 }
        )
          .then(() => {
            if (Object.keys(images).length === 0) {
              return _cb({
                error: {
                  code: 500,
                  message: 'No Images Processed',
                },
              })
            }
            return _cb({
              result: images,
            })
          })
          .catch((err) => {
            debugErr(err.stack)
            return _cb({
              error: {
                code: 500,
                message: 'Internal error: ' + err,
              },
            })
          })
      })
    })
  }

  list(
    album,
    num_results,
    distributed,
    { withMetadata: unsanWithMetadata } = {},
    _cb
  ) {
    let withMetadata
    try {
      withMetadata = unsanWithMetadata
        ? JSON.parse(unsanWithMetadata)
        : undefined
    } catch (err) {
      debugErr('Unable to parse args:', err.message)
    }

    sanitizeRequiredArguments([album], (err, args) => {
      if (err || !args) {
        return _cb({
          error: {
            code: 400,
            message: err.message,
          },
        })
      }
      const [album] = args

      const album_path = path.join(this.imagePath, album)
      const albumTagsPath = sanitizeToRoot(this.tagsPath, album)

      let images = {}
      Promise.resolve(listAlbumFiles(album_path, album)).then((files) => {
        // No files to loop on
        if (!files.length) {
          return _cb({
            error: {
              code: 500,
              message: 'No Files Processed',
            },
          })
        }

        // Process only a subset if requested
        if (num_results) {
          const n = sanitizeNumResults(num_results)
          if (n === null) {
            return _cb({
              error: { code: 400, message: 'Invalid num_results' },
            })
          }
          files = limitResults(files, n, distributed)
        }

        Promise.map(
          files,
          (file) => {
            const image_path = path.join(album_path, file)

            return Promise.resolve().then(async () => {
              let image_metadata
              try {
                image_metadata = await new Promise((resolve, reject) =>
                  imageProcessing.getMetadata(
                    image_path,
                    (err, imageMetadata) => {
                      if (err) {
                        return reject(err)
                      }
                      return resolve(imageMetadata)
                    }
                  )
                )
              } catch (err) {
                debugErr(err)
                return
              }

              // Description comes from an optional sidecar "<file>.txt" next to the
              // image. When absent, leave it unset rather than falling back to the
              // filename (the filename is already the title in the UI).
              try {
                const desc = (
                  await fs.promises.readFile(image_path + '.txt', 'utf8')
                ).trim()
                if (desc) image_metadata['description'] = desc
              } catch (_) {
                // no sidecar description; leave it unset
              }
              if (withMetadata && Array.isArray(withMetadata.tags)) {
                // TODO unique
                image_metadata['tags'] = await withMetadata.tags.reduce(
                  async (acc, unsanTag) => {
                    // An async reducer's accumulator is a PROMISE from the 2nd
                    // iteration on — it must be awaited before spreading (the
                    // same `await acc` the updateImageData reducers use), or a
                    // 2+ tag request throws "acc is not iterable" → 500.
                    const tags = await acc
                    const tag = sanitize(unsanTag)
                    const albumTagImagePath = sanitizeToRoot(
                      albumTagsPath,
                      path.join(tag, file)
                    )
                    try {
                      await fs.promises.stat(albumTagImagePath)
                    } catch (err) {
                      return tags
                    }
                    return [...tags, tag]
                  },
                  []
                )
              }
              images[file] = image_metadata
              return
            })
          },
          { concurrency: 16 }
        )
          .then(() => {
            if (Object.keys(images).length === 0) {
              return _cb({
                error: {
                  code: 500,
                  message: 'No Images Processed',
                },
              })
            }
            return _cb({
              result: images,
            })
          })
          .catch((err) => {
            debugErr(err.stack)
            return _cb({
              error: {
                code: 500,
                message: 'Internal error: ' + err,
              },
            })
          })
      })
    })
  }

  albums(_cb) {
    fs.readdir(this.imagePath, async (err, files) => {
      if (err) {
        return _cb({
          error: {
            code: 500,
            message: err.message,
          },
        })
      }
      // No files to loop on
      if (!files.length) {
        return _cb({
          error: {
            code: 500,
            message: 'No Albums Processed',
          },
        })
      }

      // Admin-managed excludes: a top-level entry hides the whole album. A nested
      // entry (e.g. "work/scans") is a single-segment vs multi-segment mismatch
      // here, so it never hides the album "work" — only its build/enrichment
      // walks skip the subtree.
      const excludes = await runtimeConfig.getExcludes()

      let dirs = {}
      for (let i = 0; i < files.length; i++) {
        try {
          let file = files[i]
          if (runtimeConfig.isExcluded(file, excludes)) continue
          if (fs.statSync(path.join(this.imagePath, file)).isDirectory()) {
            dirs[file] = { description: file }
          }
        } catch (e) {
          //ignore failed stat, not a directory or file, probably failed symlink
        }
      }

      return _cb({
        result: dirs,
      })
    })
  }

  async updateImageData(album, image, { tags }) {
    let args
    try {
      args = await sanitizeRequiredArgumentsAsync([album, image])
    } catch (err) {
      return {
        error: {
          code: 400,
          message: err.message,
        },
      }
    }
    const [sanAlbum, sanImage] = args
    // delete args

    const imagePath = sanitizeToRoot(
      this.imagePath,
      path.join(sanAlbum, sanImage)
    )

    try {
      if (!(await fs.promises.stat(imagePath)).isFile()) {
        throw new Error('Not a file')
      }
    } catch (err) {
      debugErr('Error: ', err.message)
      return {
        error: {
          code: 400,
          message: `No file found for ${sanAlbum} ${sanImage}`,
        },
      }
    }

    if (Array.isArray(tags)) {
      const sanTags = tags.map((tag) => sanitize(tag))
      debug(`Updating ${imagePath} tags to:`, sanTags)
      const albumTagsPath = sanitizeToRoot(this.tagsPath, sanAlbum)

      // Find all current tag symlinks and remove them
      let tagDirs = []
      try {
        tagDirs = await fs.promises.readdir(albumTagsPath)
      } catch (err) {
        //ignore failed stat, not a directory or file
        debug('Ignoring failure:', err.message)
      }

      await tagDirs.reduce(async (acc, tagDir) => {
        await acc

        if (sanTags.includes(tagDir)) {
          return
        }

        const albumTagDir = path.join(albumTagsPath, tagDir)
        const albumTagImagePath = sanitizeToRoot(albumTagDir, sanImage)

        try {
          debug(`Removing tag ${tagDir} relationship:`, albumTagImagePath)
          await fs.promises.unlink(albumTagImagePath)
        } catch (err) {
          //ignore failed stat, not a directory or file
          debug('Ignoring failure:', err.message)
        }
        return
      }, Promise.resolve())

      // Create symlinks to the file
      await sanTags.reduce(async (acc, tag) => {
        await acc

        const albumTagDir = sanitizeToRoot(albumTagsPath, tag)
        await mkdirp(albumTagDir) // Try to make it if it does not exist yet
        const albumTagImagePath = sanitizeToRoot(albumTagDir, sanImage)

        try {
          // TODO
          // if ((await fs.promises.stat(albumTagImagePath)).isSymbolicLink()) {
          await fs.promises.stat(albumTagImagePath)
          // Already exists
          debug(`Tag ${tag} relationship already exists`, albumTagImagePath)
          return
        } catch (err) {
          //ignore failed stat, not a directory or file
          debug('Ignoring failure:', err.message)
        }

        debug(`Creating tag ${tag} relationship`, albumTagImagePath)
        await fs.promises.symlink(imagePath, albumTagImagePath)
      }, Promise.resolve())
    }

    return {
      result: {
        message: 'ok',
      },
    }
  }
}

module.exports = imageHandler
