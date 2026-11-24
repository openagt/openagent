import type { OptionPlaces } from '@openagt/ui/module'
import { IMAGE_KINDS, IMAGE_MAX_BYTES, IMAGE_MAX_EDGE, IMAGE_TYPES, IMAGES_PER_MESSAGE, imageAddress } from '../src/image-bounds.js'
import { server } from './reads.js'

/**
 * Where the images a message goes with are kept (`composer.images`): this computer's store, which a
 * run here is handed them from. The message box keeps each through the server part as it comes in,
 * and shows a kept one from the module's route.
 */
export const images: { place: 'composer.images'; id: string } & OptionPlaces['composer.images'] = {
  place: 'composer.images',
  id: 'images',
  types: IMAGE_TYPES,
  kinds: IMAGE_KINDS,
  maxBytes: IMAGE_MAX_BYTES,
  maxEdge: IMAGE_MAX_EDGE,
  perMessage: IMAGES_PER_MESSAGE,
  keep: (host, image) => server(host).keepImage(image),
  src: imageAddress,
}
