import { ApolloServer } from "apollo-server-micro"
import { DateTimeResolver } from "graphql-scalars"
import { NextApiHandler } from "next"
import {
  asNexusMethod,
  makeSchema,
  nonNull,
  nullable,
  objectType,
  stringArg,
  subscriptionType,
} from "nexus"
import path from "path"
import cors from "micro-cors"
import prisma from "../../lib/prisma"

export const GQLDate = asNexusMethod(DateTimeResolver, "date")

const Profile = objectType({
  name: "Profile",
  definition(t) {
    t.nonNull.int("id")
    t.string("bio")
    t.field("user", {
      type: "User",
      resolve: (parent, _, context) => {
        return context.prisma.profile
          .findUnique({
            where: { id: parent.id || undefined },
          })
          .user()
      },
    })
  },
})

const User = objectType({
  name: "User",
  definition(t) {
    t.int("id")
    t.string("name")
    t.string("email")
    t.list.field("posts", {
      type: "Post",
      resolve: parent =>
        prisma.user
          .findUnique({
            where: { id: Number(parent.id) },
          })
          .posts(),
    })
    t.field("profile", {
      type: "Profile",
      resolve: (parent, _, context) => {
        return context.prisma.user
          .findUnique({
            where: { id: Number(parent.id) },
          })
          .profile()
      },
    })
  },
})

const Post = objectType({
  name: "Post",
  definition(t) {
    t.int("id")
    t.string("title")
    t.nullable.string("content")
    t.boolean("published")
    t.nullable.field("author", {
      type: "User",
      resolve: parent =>
        prisma.post
          .findUnique({
            where: { id: Number(parent.id) },
          })
          .author(),
    })
  },
})

const Query = objectType({
  name: "Query",
  definition(t) {
    t.field("post", {
      type: "Post",
      args: {
        postId: nonNull(stringArg()),
      },
      resolve: (_, args) => {
        return prisma.post.findUnique({
          where: { id: Number(args.postId) },
        })
      },
    })

    t.list.field("feed", {
      type: "Post",
      resolve: (_parent, _args) => {
        return prisma.post.findMany({
          where: { published: true },
        })
      },
    })

    t.list.field("drafts", {
      type: "Post",
      resolve: (_parent, _args, ctx) => {
        return prisma.post.findMany({
          where: { published: false },
        })
      },
    })

    t.list.field("filterPosts", {
      type: "Post",
      args: {
        searchString: nullable(stringArg()),
      },
      resolve: (_, { searchString }, ctx) => {
        return prisma.post.findMany({
          where: {
            OR: [
              { title: { contains: searchString } },
              { content: { contains: searchString } },
            ],
          },
        })
      },
    })
  },
})

const Mutation = objectType({
  name: "Mutation",
  definition(t) {
    t.field("signupUser", {
      type: "User",
      args: {
        name: stringArg(),
        email: nonNull(stringArg()),
      },
      resolve: (_, { name, email }, ctx) => {
        return prisma.user.create({
          data: {
            name,
            email,
          },
        })
      },
    })

    t.nullable.field("deletePost", {
      type: "Post",
      args: {
        postId: stringArg(),
      },
      resolve: (_, { postId }, ctx) => {
        return prisma.post.delete({
          where: { id: Number(postId) },
        })
      },
    })

    t.field("createDraft", {
      type: "Post",
      args: {
        title: nonNull(stringArg()),
        content: stringArg(),
        authorEmail: stringArg(),
      },
      resolve: (_, { title, content, authorEmail }, ctx) => {
        return prisma.post.create({
          data: {
            title,
            content,
            published: false,
            author: {
              connect: { email: authorEmail },
            },
          },
        })
      },
    })

    t.nullable.field("publish", {
      type: "Post",
      args: {
        postId: stringArg(),
      },
      resolve: (_, { postId }, ctx) => {
        return prisma.post.update({
          where: { id: Number(postId) },
          data: { published: true },
        })
      },
    })
    t.field("addProfileForUser", {
      type: "Profile",
      args: {
        email: stringArg(),
        bio: stringArg(),
      },
      resolve: async (_, args, context) => {
        return context.prisma.profile.create({
          data: {
            bio: args.bio,
            user: {
              connect: {
                email: args.email || undefined,
              },
            },
          },
        })
      },
    })
  },
})

// subscriptionを行うためには、
// https://www.apollographql.com/docs/apollo-server/features/subscriptions/
// const Subscription = subscriptionType({
//   definition(t) {
//     t.field("postAdded", {
//       type: "Post",
//       subscribe(root, args, ctx) {
//         return ctx.prisma.$subscribe.post({
//           mutation_in: ["CREATED"],
//         })
//       },
//       resolve: payload => payload,
//     })
//   },
// })

export const schema = makeSchema({
  types: [Query, Mutation, Post, User, Profile, GQLDate],
  outputs: {
    typegen: path.join(process.cwd(), "generated/nexus-typegen.ts"),
    schema: path.join(process.cwd(), "generated/schema.graphql"),
  },
})

export const config = {
  api: {
    bodyParser: false,
  },
}

const apolloServer = new ApolloServer({ schema })

let apolloServerHandler: NextApiHandler

async function getApolloServerHandler() {
  if (!apolloServerHandler) {
    await apolloServer.start()

    apolloServerHandler = apolloServer.createHandler({
      path: "/api",
    })
  }

  return apolloServerHandler
}

const handler: NextApiHandler = async (req, res) => {
  const apolloServerHandler = await getApolloServerHandler()

  if (req.method === "OPTIONS") {
    res.end()
    return
  }

  return apolloServerHandler(req, res)
}

export default cors()(handler)
