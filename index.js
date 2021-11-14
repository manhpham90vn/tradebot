const ccxt = require('ccxt')
const moment = require('moment')
const delay = require('delay')
const dotenv = require('dotenv')

// config env
dotenv.config()

// cons
const STEP = 5
const TRADE_SIZE = 100
const COIN = 'ETH/USDT'

// api key
const binace = new ccxt.binance({
    apiKey: process.env.APIKEY,
    secret: process.env.SECRET
});

binace.setSandboxMode(true)

async function getBalance(btcPrice) {
    const balance = await binace.fetchBalance();
    const total = balance.total
    console.log(`Balance: ETH ${total.ETH}, USDT: ${total.USDT}`)
    console.log(`Total USDT: ${total.ETH * btcPrice + total.USDT} \n`)
}

async function tick() {
    const price = await binace.fetchOHLCV(COIN, '1m', undefined, STEP);
    const bPrices = price.map(price => {
        return {
            timestamp: moment(price[0]).format(),
            open: price[1],
            hight: price[2],
            low: price[3],
            close: price[4],
            volume: price[5]
        }
    })
    const averagePrice = bPrices.reduce((acc, price) => acc + price.close, 0) / STEP
    const lastPrice = bPrices[bPrices.length - 1].close
    const direction = lastPrice > averagePrice ? 'sell' : 'buy'
    console.log(`Average price: ${averagePrice}. Last Price: ${lastPrice}`)
    const QUANTILY = TRADE_SIZE / lastPrice
    const order = await binace.createMarketOrder(COIN, direction, QUANTILY)
    console.log(`${moment().format()}: ${direction} ${QUANTILY} ${COIN} at ${lastPrice}`)
    getBalance(lastPrice)
}

async function main() {
    while (true) {
        await tick()
        await delay(60 * 1000)
    }
}

main()