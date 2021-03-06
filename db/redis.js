const Redis = require('ioredis')
// 导入配置
const { redisConfig } = require('../config/dbConfig.js')

// 导入配置
const config = require('../config/config.js')

const redisClient = new Redis({
  host: redisConfig.host,
  port: redisConfig.port,
})

// redis准备
redisClient.on('ready', function (error) {
  console.log('redis 已准备好')
})

// redis连接
redisClient.on('connect', function (error) {
  console.log('[主进程]【redis】 已连接 监听 127.0.0.1:6379')
  if (redisConfig.INIT_CLEAR) {
    // redisClient.flushdb(() => {
    //   console.log('初始化清空redis')
    // })
  }
})

// redis重新连接
redisClient.on('reconnecting', function (error) {
  console.log('redis 已重新连接')
})

// redis关闭
redisClient.on('end', function (error) {
  console.log('redis 已关闭')
})

// redis警告
redisClient.on('warning', function (error) {
  console.log('redis 发出警告')
})

// redis出错
redisClient.on('error', function (error) {
  console.error(error)
  redisClient.quit(() => {
    console.log('redis 已退出')
  })
})

/* 数据库 curd */
// 校验设备是否存在用户名下,存在则获取设备密钥
async function checkDevice(user, secret) {
  let deviceList = await redisClient.hget(user, 'deviceList')
  if (deviceList) {
    deviceList = JSON.parse(deviceList) || []
    for (const car of deviceList) {
      if (car.secret === secret) {
        return car.secret
      }
    }
  }
  return false
}

// 校验设备是否已注册过
async function checkDeviceRegister(secret) {
  return await redisClient.hexists(`device:${secret}`, 'exists')
}

// 登记小车
async function registerDevice(secret) {
  if (await redisClient.hexists(`device:${secret}`, 'exists')) return true
  await redisClient.hsetnx(
    `device:${secret}`,
    'exists',
    new Date().toLocaleString()
  )
  return true
}

// 修改设备
async function changeDevice(type, user, secret, name) {
  // 设备未登记过，无法绑定
  if (!(await checkDeviceRegister(secret))) return false
  let flag
  // 不存在设备列表则创建
  await redisClient.hsetnx(user, 'deviceList', JSON.stringify([]))
  // 获取并解析设备列表
  let deviceList = await redisClient.hget(user, 'deviceList')
  deviceList = JSON.parse(deviceList) || []

  for (let i = 0; i < deviceList.length; i++) {
    //删除设备
    if (type === 'delete' && deviceList[i].secret === secret) {
      deviceList.splice(i, 1) // 解绑设备与用户
      flag = 1
      break
    } else if (type === 'edit') {
      // 编辑设备，已存在过
      if (deviceList[i].name === name || deviceList[i].secret === secret) {
        deviceList[i].name = name
        deviceList[i].secret = secret || deviceList[i].secret
        flag = 1
        break
      }
    }
  }
  // 未处理，则新增
  if (!flag) {
    deviceList.push({
      name: name,
      secret: secret,
    })
  }
  // 重新设置用户绑定的设备列表
  await redisClient.hset(user, `deviceList`, JSON.stringify(deviceList))
  return await redisClient.hget(user, `deviceList`)
}

// 通用修改设备属性
async function modify(type, user, secret, data) {
  // 用户名设备 device:{secret}
  secret = await checkDevice(user, secret)
  if (secret) {
    switch (type) {
      case 'connectMqtt':
      case 'connectCloudControl':
      case 'entryBootloader':
      case 'resetMqtt':
      case 'resetCloudControl':
        await redisClient.hset(`device:${secret}`, type, data)
        break
      case 'sync':
        await redisClient.hset(`device:${secret}`, type, data.join())
        break
      case 'default':
        await redisClient.hset(`device:${secret}`, type, JSON.stringify(data))
        break
      default:
        return false
    }
    return true
  }
  return false
}

// 通用获取设备属性
async function get(type, user, secret) {
  // 用户设备 device:{secret}
  if (await checkDevice(user, secret)) {
    return await redisClient.hget(`device:${secret}`, type)
  }
  return false
}

// 通用获取公共属性
async function public(type, user) {
  // 获取用户属性
  return await redisClient.hget(user, type)
}

// 设备管理
async function manage(type, user, secret, name) {
  switch (type) {
    case 'delete':
    case 'edit':
      return await changeDevice(type, user, secret, name)
    default:
      return false
  }
}


/* 登录注册数据库操作 */
// 校验用户存在
async function checkHasUser(user) {
  return await redisClient.hexists(user, 'exists')
}

// 登录密码校验
async function checkUserPass(user, password) {
  return (await redisClient.hget(user, 'password')) === password
}

// 注册账号
async function registerAccount(user, password) {
  // 注册账号
  if (!(await redisClient.hset(user, 'password', password))) {
    return false
  }
  // 标记为存在,并记录创建时间
  if (!(await redisClient.hset(user, 'exists', new Date().toLocaleString()))) {
    return false
  }
  return true
}

// token 有效性校验
async function checkToken(token, user) {
  // 存在user名称,校验token是否为指定用户所有
  if (user) {
    return (await redisClient.get(token)) === user
  } else {
    // 在线校验 token 存在
    return await redisClient.get(token)
  }
}

// token 记录生成,只在登录或者重新激活还未过期时重新设置token
async function createToken(token, user) {
  // 设置账号一小时过期
  return redisClient.setex(token, config.COOKIE_MAXAGE, user)
}

module.exports = {
  redisClient,
  checkHasUser,
  checkUserPass,
  registerAccount,
  checkToken,
  createToken,
  modify,
  checkDevice,
  get,
  public,
  manage,
  registerDevice,
}
