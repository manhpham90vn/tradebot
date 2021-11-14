const chart = require('asciichart')
const fs = require('fs')
const delay = require('delay');

function plotAsset() {
    const lines = fs.readFileSync('./trade_log.txt', 'utf8').split('\n')
    const assets = []

    for (const line of lines) {
        if (line.includes('Total USDT')) {
            const asset = line.replace('Total USDT:', '').trim()
            assets.push(parseInt(asset))
        }
    }
    console.clear()
    console.log(chart.plot(assets, {
        height: 30
    }))
}

async function main() {
    while (true) {
        plotAsset()
        await delay(60 * 1000)
    }
}

main()