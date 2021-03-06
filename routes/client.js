const fs = require('fs')
// 导入tcp发送数据特权方法
const { sendDataByTCP } = require('../server/tcpServer')
// // 导入websocket发送数据特权方法
// const { sendDataByWebSocket } = require('../server/webSocketServer')
// redis数据库
const Redis = require('../db/redis')
// token
const jwt = require('jsonwebtoken')
// 盐
const config = require('../config/config')

module.exports = (router) => {
  // 通用修改设备属性
  router.post('/modify/:type', async (ctx, next) => {
    const body = ctx.request.body
    const type = ctx.request.params.type
    if (body.user && body.secret) {
      if (await Redis.modify(type, body.user, body.secret, body.data)) {
        return (ctx.body = {
          state: 0,
          message: '保存成功',
        })
      }
    }
    ctx.body = {
      state: 1,
      message: '保存失败',
    }
  })

  // 更新小车固件
  router.post('/upload/:type', async (ctx, next) => {
    const files = ctx.request.files
    const body = ctx.request.body
    if (files.file.path && body.secret) {
      fs.readFile(files.file.path, (err, chunk) => {
        sendDataByTCP(body.secret, chunk)
      })
      return (ctx.body = {
        state: 0,
        message: '上传成功',
      })
    }
    return (ctx.body = {
      state: 1,
      message: '上传失败',
    })
  })

  // 通用获取设备属性
  router.post('/get/:type', async (ctx, next) => {
    const body = ctx.request.body
    const type = ctx.request.params.type
    if (body.user && body.secret) {
      const res = await Redis.get(type, body.user, body.secret)
      if (res) {
        return (ctx.body = {
          state: 0,
          message: '获取成功',
          data: res,
        })
      }
    }
    ctx.body = {
      state: 1,
      message: '获取失败',
    }
  })

  // 通用获取公共属性
  router.post('/public/:type', async (ctx, next) => {
    const body = ctx.request.body
    const type = ctx.request.params.type
    if (body.user) {
      const res = await Redis.public(type, body.user)
      if (res) {
        return (ctx.body = {
          state: 0,
          message: '获取成功',
          data: res,
        })
      }
    }
    ctx.body = {
      state: 1,
      message: '获取失败',
    }
  })

  // 设备管理
  router.post('/manage/:type', async (ctx, next) => {
    const body = ctx.request.body
    const type = ctx.request.params.type
    // 此 secret 为设备密钥
    if (body.user && body.secret) {
      const res = await Redis.manage(type, body.user, body.secret, body.name)
      if (res) {
        return (ctx.body = {
          state: 0,
          message: '操作成功',
          data: res,
        })
      }
    }
    ctx.body = {
      state: 1,
      message: '操作失败',
    }
  })

  // 直接执行指令
  router.post('/command/:type', async (ctx, next) => {
    const body = ctx.request.body
    const type = ctx.request.params.type
    const data = {[type]:body.data}
    // 此 secret 为设备密钥
    if (body.user && body.secret) {
      // 发送指令到设备
      if (sendDataByTCP(body.secret,`@@@@${JSON.stringify(data)}$`)) {
        return (ctx.body = {
          state: 0,
          message: '操作成功',
        })
      }
    }
    ctx.body = {
      state: 1,
      message: '操作失败',
    }
  })

  /* 账号相关路由 */

  // 注册账号
  router.post('/register', async (ctx, next) => {
    const body = ctx.request.body
    // 校验用户存在
    if (await Redis.checkHasUser(body.user)) {
      return (ctx.body = {
        state: 1,
        message: '用户已存在',
      })
    }

    // 注册账号
    if (!(await Redis.registerAccount(body.user, body.password))) {
      return (ctx.body = {
        state: 1,
        message: '注册失败',
      })
    }

    ctx.body = {
      state: 0,
      message: '注册成功',
    }
  })

  // 登录校验
  router.post('/login', async (ctx, next) => {
    const body = ctx.request.body
    // 校验用户存在
    if (!(await Redis.checkHasUser(body.user))) {
      return (ctx.body = {
        state: 1,
        message: '用户不存在',
      })
    }

    // 校验密码有效性
    if (!(await Redis.checkUserPass(body.user, body.password))) {
      return (ctx.body = {
        state: 1,
        message: '密码错误',
      })
    }

    // 生成token
    const token = jwt.sign(
      {
        user: body.user,
        password: body.password,
        time: Date.now(),
        maxAge: config.COOKIE_MAXAGE * 1000, // token最大过期时间
      },
      config.SECRET
    )

    // 生成并记录token
    if (!(await Redis.createToken(token, body.user))) {
      return (ctx.body = {
        state: 1,
        message: '登录失败',
      })
    }

    ctx.body = {
      state: 0,
      message: '登录成功',
      token: token,
    }
  })
}
