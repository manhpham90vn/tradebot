const ccxt = require('ccxt')
const moment = require('moment')
const delay = require('delay')
const dotenv = require('dotenv')

// config env
dotenv.config()

// cons
const STEP_MINUS_1M = 60
const STEP = 10
const COIN = 'GMT/USDT'
const PROFIT_PRICE = 0.2
const STOP_LOSS = -0.1
var currentDirection = null

// api key
const binanceExchange = new ccxt.binanceusdm({
    apiKey: process.env.APIKEY,
    secret: process.env.SECRET,
    options: {
        'defaultType': 'future' 
    },
    rateLimit: true
});

async function getInfo() {
    // load markets
    await binanceExchange.loadMarkets()

    // get total usdt
    const balance = await binanceExchange.fetchBalance();
    const totalUSDT = balance.total.USDT
    console.log(`Total USDT: ${totalUSDT}`)

    // analytics in 60m
    const priceResponse = await binanceExchange.fetchOHLCV(COIN, '1m', undefined, STEP_MINUS_1M)
    const priceObject = priceResponse.map(price => {
        return {
            timestamp: moment(price[0]).format(),
            open: price[1],
            hight: price[2],
            low: price[3],
            close: price[4],
            volume: price[5]
        }
    })
    const hight = Math.max(...priceObject.map(e => e.hight))
    const low = Math.min(...priceObject.map(e => e.low))
    const average = (hight + low) / 2
    const lastPrice = priceObject[priceResponse.length - 1].close
    console.log(`Hight: ${hight} Low: ${low} Average: ${average} Current: ${lastPrice}`)

    // get positions
    const positions = balance.info.positions
    var hadPosition = false
    for (let i = 0; i < positions.length; i++) {
        const position = positions[i]
        if (position.positionAmt > 0) {
            console.log(position)
            hadPosition = true
            let unrealizedProfit = position.unrealizedProfit
            if (unrealizedProfit >= PROFIT_PRICE || unrealizedProfit >= -STOP_LOSS) {
                close(position.notional)
            }
            break
        }
        hadPosition = false
    }
    if (!hadPosition) {
        order(totalUSDT, average, lastPrice)
    }
}

async function order(totalUSDT, average, lastPrice) {
     const direction = lastPrice > average ? 'sell' : 'buy'
     currentDirection = direction
     const order = await binanceExchange.createOrder(COIN, 'market', direction, totalUSDT * STEP)
     console.log(order)
}

async function close(notional) {
    newDirection = currentDirection == 'sell' ? 'buy' : 'sell'
    const order = await binanceExchange.createOrder(COIN, 'market', newDirection, notional)
}

async function main() {
    while (true) {
        await getInfo()
        await delay(3000)
        console.log(`------------------------------------------------------------`)
    }
}

main()