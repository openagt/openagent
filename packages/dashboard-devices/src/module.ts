import { defineModule, type ModuleDefinition } from '@openagt/hooks'
import { startDoorProcess, type DoorProcess, type DoorProcessOptions } from './door-process.js'

/**
 * devices, a plugin kept per computer (#2394): the door, OpenAgent's only network listener (on
 * this Wi-Fi, on Tailscale, or over HTTPS on a server), the devices paired at it, and the
 * person's other computers. It starts off: switched on, its door's process runs for as long as
 * OpenAgent does, and its Settings entry, its Overview card and the Allow popup are there. The
 * person's other computers are reached by OpenAgent's own code where devices is on, until that
 * code moves here.
 */
export function devicesModule(door: Partial<Pick<DoorProcessOptions, 'bin' | 'env' | 'log'>> = {}): ModuleDefinition {
  let running: DoorProcess | undefined
  return defineModule({
    name: 'devices',
    plugin: { scope: 'computer' },
    hooks: {
      'app.lifecycle': {
        started(app) {
          if (app.url === undefined || running) return
          running = startDoorProcess({
            env: door.env ?? process.env,
            log: door.log ?? (line => console.log(line)),
            ...(door.bin !== undefined ? { bin: door.bin } : {}),
            url: app.url,
            ...(app.computer !== undefined ? { computer: app.computer } : {}),
          })
        },
        async stopping() {
          const stopping = running
          running = undefined
          await stopping?.stop()
        },
      },
    },
  })
}

export default devicesModule()
