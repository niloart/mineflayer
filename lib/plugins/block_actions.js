const { Vec3 } = require('vec3')

module.exports = inject

const CARDINALS = {
  north: new Vec3(0, 0, -1),
  south: new Vec3(0, 0, 1),
  west: new Vec3(-1, 0, 0),
  east: new Vec3(1, 0, 0)
}

const FACING_MAP = {
  north: { west: 'right', east: 'left' },
  south: { west: 'left', east: 'right' },
  west: { north: 'left', south: 'right' },
  east: { north: 'right', south: 'left' }
}

function inject (bot) {
  const { instruments, blocks } = bot.registry

  // Stores how many players have currently open a container at a certain position
  const openCountByPos = {}

  function parseChestMetadata (chestBlock) {
    const chestTypes = ['single', 'right', 'left']

    return bot.supportFeature('doesntHaveChestType')
      ? { facing: Object.keys(CARDINALS)[chestBlock.metadata - 2] }
      : {
          waterlogged: !(chestBlock.metadata & 1),
          type: chestTypes[(chestBlock.metadata >> 1) % 3],
          facing: Object.keys(CARDINALS)[Math.floor(chestBlock.metadata / 6)]
        }
  }

  function getChestType (chestBlock) { // Returns 'single', 'right' or 'left'
    if (bot.supportFeature('doesntHaveChestType')) {
      const facing = parseChestMetadata(chestBlock).facing

      if (!facing) return 'single'

      // We have to check if the adjacent blocks in the perpendicular cardinals are the same type
      const perpendicularCardinals = Object.keys(FACING_MAP[facing])
      for (const cardinal of perpendicularCardinals) {
        const cardinalOffset = CARDINALS[cardinal]
        if (bot.blockAt(chestBlock.position.plus(cardinalOffset))?.type === chestBlock.type) {
          return FACING_MAP[cardinal][facing]
        }
      }

      return 'single'
    } else {
      return parseChestMetadata(chestBlock).type
    }
  }

  bot._client.on('block_action', (packet) => {
    const pt = new Vec3(packet.location.x, packet.location.y, packet.location.z)
    const block = bot.blockAt(pt)

    // Ignore on non-vanilla blocks
    if (block === null || !blocks[packet.blockId]) { return }

    const blockName = blocks[packet.blockId].name

    if (blockName === 'noteblock') { // Pre 1.13
      bot.emit('noteHeard', block, instruments[packet.byte1], packet.byte2)
    } else if (blockName === 'note_block') { // 1.13 onward
      bot.emit('noteHeard', block, instruments[Math.floor(block.metadata / 50)], Math.floor((block.metadata % 50) / 2))
    } else if (blockName === 'sticky_piston' || blockName === 'piston') {
      bot.emit('pistonMove', block, packet.byte1, packet.byte2)
    } else {
      let block2 = null

      if (blockName === 'chest' || blockName === 'trapped_chest') {
        const chestType = getChestType(block)
        if (chestType === 'right') {
          const index = Object.values(FACING_MAP[parseChestMetadata(block).facing]).indexOf('left')
          const cardinalBlock2 = Object.keys(FACING_MAP[parseChestMetadata(block).facing])[index]
          const block2Position = block.position.plus(CARDINALS[cardinalBlock2])
          block2 = bot.blockAt(block2Position)
        } else if (chestType === 'left') return // Omit left part of the chest so 'chestLidMove' doesn't emit twice when it's a double chest
      }

      // Emit 'chestLidMove' only if the number of players with the lid open changes
      if (openCountByPos[block.position] !== packet.byte2) {
        bot.emit('chestLidMove', block, packet.byte2, block2)

        if (packet.byte2 > 0) {
          openCountByPos[block.position] = packet.byte2
        } else {
          delete openCountByPos[block.position]
        }
      }
    }
  })

  bot._client.on('block_break_animation', (packet) => {
    const destroyStage = packet.destroyStage
    const pt = new Vec3(packet.location.x, packet.location.y, packet.location.z)
    const block = bot.blockAt(pt)
    const entity = bot.entities[packet.entityId]

    if (destroyStage < 0 || destroyStage > 9) {
      // http://minecraft.wiki/w/Protocol#Block_Break_Progress
      // "0-9 to set it, any other value to remove it"
      bot.emit('blockBreakProgressEnd', block, entity)
    } else {
      bot.emit('blockBreakProgressObserved', block, destroyStage, entity)
    }
  })
}
