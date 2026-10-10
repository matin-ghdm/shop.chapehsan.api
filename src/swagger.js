const path = require("path");
const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "ch-back API",
      version: "1.0.0",
      description: "Express.js API connected to chapehsan PostgreSQL database",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local server",
      },
      {
        url: "https://shop-chapehsan-api.onrender.com",
        description: "Production (Render)",
      },
    ],
    tags: [
      { name: "General", description: "Health and system" },
      { name: "Users", description: "User registration, login and CRUD" },
      { name: "Addresses", description: "User addresses CRUD" },
      { name: "Slides", description: "Homepage / design slider" },
      { name: "Downloads", description: "Downloadable files" },
      { name: "Designs", description: "Design catalog" },
      { name: "Orders", description: "Order CRUD" },
      { name: "OrderItems", description: "Order items CRUD" },
      { name: "Database", description: "Database helpers" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string", example: "علی" },
            lname: { type: "string", example: "رضایی" },
            phone: { type: "string", example: "09121234567" },
            email: { type: "string", nullable: true, example: "ali@example.com" },
            role: { type: "string", enum: ["user", "admin"], example: "user" },
            created_at: { type: "string", format: "date-time" },
          },
        },
        AuthResponse: {
          type: "object",
          properties: {
            user: { $ref: "#/components/schemas/User" },
            token: { type: "string" },
          },
        },
        Address: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            user_id: { type: "string", format: "uuid" },
            title: { type: "string", nullable: true, example: "منزل" },
            province: { type: "string", example: "تهران" },
            city: { type: "string", example: "تهران" },
            address: { type: "string", example: "خیابان ولیعصر، پلاک 12" },
            postal_code: { type: "string", nullable: true, example: "1234567890" },
            phone: { type: "string", nullable: true, example: "09121234567" },
            created_at: { type: "string", format: "date-time" },
          },
        },
        Slide: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            placement: { type: "string", enum: ["home", "design"], example: "home" },
            image_path: { type: "string", example: "/uploads/slides/banner1.jpg" },
            alt: { type: "string", example: "بنر صفحه اصلی" },
            title: { type: "string", nullable: true },
            caption: { type: "string", nullable: true },
            link: { type: "string", nullable: true },
            sort_order: { type: "integer", example: 0 },
            is_active: { type: "boolean", example: true },
            created_at: { type: "string", format: "date-time" },
          },
        },
        Download: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string", example: "لایه نقشه کربلا" },
            description: { type: "string", nullable: true },
            type: { type: "string", enum: ["layer", "pdf", "map", "other"], example: "pdf" },
            file_path: { type: "string", example: "/uploads/downloads/file.pdf" },
            format: { type: "string", nullable: true, example: "pdf" },
            is_protected: { type: "boolean", example: false },
            uploaded_at: { type: "string", format: "date-time" },
          },
        },
        Design: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            code: { type: "string", example: "KRB-001" },
            type: {
              type: "string",
              enum: ["taslit", "stand", "hajj", "karbala", "davati", "hamdardi", "sarbarg", "occasion", "laser"],
              example: "karbala",
            },
            category: { type: "string", nullable: true, example: "کربلا" },
            title: { type: "string", example: "طرح کربلا 1" },
            image_path: { type: "string", example: "/uploads/designs/karbala-1.jpg" },
            image_paths: { type: "array", maxItems: 3, items: { type: "string" }, description: "Product images, primary image first" },
            banner_text: { type: "string", maxLength: 5000, description: "Banner template with {مخاطب}, {نام متوفی}, {از طرف} placeholders" },
            price: { type: "integer", example: 250000 },
            is_active: { type: "boolean", example: true },
            created_at: { type: "string", format: "date-time" },
          },
        },
        OrderItem: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            order_id: { type: "string", format: "uuid" },
            design_id: { type: "string", format: "uuid" },
            quantity: { type: "integer", example: 1 },
            unit_price: { type: "integer", example: 250000 },
            custom_data: { type: "object", additionalProperties: true },
            item_note: { type: "string", nullable: true },
          },
        },
        Order: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            user_id: { type: "string", format: "uuid" },
            user_name: { type: "string", nullable: true, description: "Customer full name" },
            user_phone: { type: "string", nullable: true, description: "Customer phone" },
            address_id: { type: "string", format: "uuid", nullable: true },
            is_pickup: { type: "boolean", example: false },
            status: {
              type: "string",
              enum: [
                "pending",
                "awaiting_payment",
                "paid",
                "confirmed",
                "printing",
                "ready",
                "delivered",
                "canceled",
              ],
            },
            total_price: { type: "integer", example: 500000 },
            note: { type: "string", nullable: true },
            created_at: { type: "string", format: "date-time" },
            items: {
              type: "array",
              items: { $ref: "#/components/schemas/OrderItem" },
            },
          },
        },
        Error: {
          type: "object",
          properties: {
            message: { type: "string" },
            code: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/users": {
        get: {
          tags: ["Users"],
          summary: "List all users",
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: "List of users",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      users: {
                        type: "array",
                        items: { $ref: "#/components/schemas/User" },
                      },
                    },
                  },
                },
              },
            },
            401: { description: "Unauthorized" },
          },
        },
      },
      "/users/register": {
        post: {
          tags: ["Users"],
          summary: "Register a new user",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "lname", "phone", "password"],
                  properties: {
                    name: { type: "string" },
                    lname: { type: "string" },
                    phone: { type: "string", example: "09121234567" },
                    email: { type: "string" },
                    password: { type: "string", format: "password" },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "User registered",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuthResponse" },
                },
              },
            },
            400: { description: "Missing required fields" },
            409: { description: "Phone already registered" },
          },
        },
      },
      "/users/login": {
        post: {
          tags: ["Users"],
          summary: "Login with phone and password",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["phone", "password"],
                  properties: {
                    phone: { type: "string", example: "09121234567" },
                    password: { type: "string", format: "password" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Login successful",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuthResponse" },
                },
              },
            },
            401: { description: "Invalid credentials" },
          },
        },
      },
      "/users/me": {
        get: {
          tags: ["Users"],
          summary: "Get current user profile",
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: "Current user",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      user: { $ref: "#/components/schemas/User" },
                    },
                  },
                },
              },
            },
            401: { description: "Unauthorized" },
          },
        },
      },
      "/users/{id}": {
        get: {
          tags: ["Users"],
          summary: "Get user by id",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: {
              description: "User found",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      user: { $ref: "#/components/schemas/User" },
                    },
                  },
                },
              },
            },
            404: { description: "User not found" },
          },
        },
        put: {
          tags: ["Users"],
          summary: "Update user",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    lname: { type: "string" },
                    phone: { type: "string" },
                    email: { type: "string" },
                    password: { type: "string", format: "password" },
                    role: {
                      type: "string",
                      enum: ["user", "admin"],
                      description: "Admin only",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "User updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      user: { $ref: "#/components/schemas/User" },
                    },
                  },
                },
              },
            },
            403: { description: "Forbidden" },
            404: { description: "User not found" },
          },
        },
        delete: {
          tags: ["Users"],
          summary: "Delete user",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: { description: "User deleted" },
            403: { description: "Forbidden" },
            404: { description: "User not found" },
          },
        },
      },
      "/addresses": {
        get: {
          tags: ["Addresses"],
          summary: "List addresses",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "query",
              name: "user_id",
              schema: { type: "string", format: "uuid" },
              description: "Admin only",
            },
          ],
          responses: {
            200: {
              description: "Addresses list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      addresses: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Address" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Addresses"],
          summary: "Create address",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["province", "city", "address"],
                  properties: {
                    user_id: {
                      type: "string",
                      format: "uuid",
                      description: "Admin only",
                    },
                    title: { type: "string", example: "منزل" },
                    province: { type: "string", example: "تهران" },
                    city: { type: "string", example: "تهران" },
                    address: { type: "string", example: "خیابان ولیعصر، پلاک 12" },
                    postal_code: { type: "string", example: "1234567890" },
                    phone: { type: "string", example: "09121234567" },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Address created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { address: { $ref: "#/components/schemas/Address" } },
                  },
                },
              },
            },
          },
        },
      },
      "/addresses/{id}": {
        get: {
          tags: ["Addresses"],
          summary: "Get address by id",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: {
              description: "Address details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { address: { $ref: "#/components/schemas/Address" } },
                  },
                },
              },
            },
            404: { description: "Not found" },
          },
        },
        put: {
          tags: ["Addresses"],
          summary: "Update address",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    province: { type: "string" },
                    city: { type: "string" },
                    address: { type: "string" },
                    postal_code: { type: "string" },
                    phone: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Address updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { address: { $ref: "#/components/schemas/Address" } },
                  },
                },
              },
            },
          },
        },
        delete: {
          tags: ["Addresses"],
          summary: "Delete address",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: { description: "Address deleted" },
            404: { description: "Not found" },
          },
        },
      },
      "/slides": {
        get: {
          tags: ["Slides"],
          summary: "List active slides (public)",
          parameters: [
            {
              in: "query",
              name: "placement",
              schema: { type: "string", enum: ["home", "design"] },
            },
          ],
          responses: {
            200: {
              description: "Active slides",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      slides: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Slide" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Slides"],
          summary: "Create slide (admin)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["image_path", "alt"],
                  properties: {
                    placement: { type: "string", enum: ["home", "design"], example: "home" },
                    image_path: { type: "string", example: "/uploads/slides/banner1.jpg" },
                    alt: { type: "string", example: "بنر صفحه اصلی" },
                    title: { type: "string" },
                    caption: { type: "string" },
                    link: { type: "string" },
                    sort_order: { type: "integer", example: 0 },
                    is_active: { type: "boolean", example: true },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Slide created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { slide: { $ref: "#/components/schemas/Slide" } },
                  },
                },
              },
            },
            403: { description: "Admin only" },
          },
        },
      },
      "/slides/admin/all": {
        get: {
          tags: ["Slides"],
          summary: "List all slides including inactive (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "query",
              name: "placement",
              schema: { type: "string", enum: ["home", "design"] },
            },
          ],
          responses: {
            200: {
              description: "All slides",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      slides: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Slide" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/slides/{id}": {
        get: {
          tags: ["Slides"],
          summary: "Get active slide by id (public)",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: {
              description: "Slide details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { slide: { $ref: "#/components/schemas/Slide" } },
                  },
                },
              },
            },
            404: { description: "Not found" },
          },
        },
        put: {
          tags: ["Slides"],
          summary: "Update slide (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    placement: { type: "string", enum: ["home", "design"] },
                    image_path: { type: "string" },
                    alt: { type: "string" },
                    title: { type: "string" },
                    caption: { type: "string" },
                    link: { type: "string" },
                    sort_order: { type: "integer" },
                    is_active: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Slide updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { slide: { $ref: "#/components/schemas/Slide" } },
                  },
                },
              },
            },
            403: { description: "Admin only" },
          },
        },
        delete: {
          tags: ["Slides"],
          summary: "Delete slide (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: { description: "Slide deleted" },
            403: { description: "Admin only" },
            404: { description: "Not found" },
          },
        },
      },
      "/downloads": {
        get: {
          tags: ["Downloads"],
          summary: "List downloads (public; protected hide file_path without token)",
          parameters: [
            {
              in: "query",
              name: "type",
              schema: { type: "string", enum: ["layer", "pdf", "map", "other"] },
            },
          ],
          responses: {
            200: {
              description: "Downloads list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      downloads: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Download" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Downloads"],
          summary: "Create download (admin)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "type", "file_path"],
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    type: { type: "string", enum: ["layer", "pdf", "map", "other"] },
                    file_path: { type: "string" },
                    format: { type: "string" },
                    is_protected: { type: "boolean", example: false },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Download created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { download: { $ref: "#/components/schemas/Download" } },
                  },
                },
              },
            },
            403: { description: "Admin only" },
          },
        },
      },
      "/downloads/{id}": {
        get: {
          tags: ["Downloads"],
          summary: "Get download by id (token required if protected)",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: {
              description: "Download details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { download: { $ref: "#/components/schemas/Download" } },
                  },
                },
              },
            },
            401: { description: "Protected file needs login" },
            404: { description: "Not found" },
          },
        },
        put: {
          tags: ["Downloads"],
          summary: "Update download (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    type: { type: "string", enum: ["layer", "pdf", "map", "other"] },
                    file_path: { type: "string" },
                    format: { type: "string" },
                    is_protected: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Download updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { download: { $ref: "#/components/schemas/Download" } },
                  },
                },
              },
            },
            403: { description: "Admin only" },
          },
        },
        delete: {
          tags: ["Downloads"],
          summary: "Delete download (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: { description: "Download deleted" },
            403: { description: "Admin only" },
            404: { description: "Not found" },
          },
        },
      },
      "/designs": {
        get: {
          tags: ["Designs"],
          summary: "List active designs (public)",
          parameters: [
            {
              in: "query",
              name: "type",
              schema: {
                type: "string",
                enum: ["taslit", "stand", "hajj", "karbala", "davati", "hamdardi", "sarbarg", "occasion", "laser"],
              },
            },
            { in: "query", name: "category", schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "Active designs",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      designs: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Design" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Designs"],
          summary: "Create design (admin)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["code", "type", "title", "image_path", "price"],
                  properties: {
                    code: { type: "string", example: "KRB-001" },
                    type: {
                      type: "string",
                      enum: ["taslit", "stand", "hajj", "karbala", "davati", "hamdardi", "sarbarg", "occasion", "laser"],
                    },
                    category: { type: "string" },
                    title: { type: "string" },
                    image_path: { type: "string" },
                    image_paths: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
                    price: { type: "integer", example: 250000 },
                    is_active: { type: "boolean", example: true },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Design created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { design: { $ref: "#/components/schemas/Design" } },
                  },
                },
              },
            },
            403: { description: "Admin only" },
            409: { description: "Duplicate type+code" },
          },
        },
      },
      "/designs/admin/all": {
        get: {
          tags: ["Designs"],
          summary: "List all designs including inactive (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "query",
              name: "type",
              schema: {
                type: "string",
                enum: ["taslit", "stand", "hajj", "karbala", "davati", "hamdardi", "sarbarg", "occasion", "laser"],
              },
            },
            { in: "query", name: "category", schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "All designs",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      designs: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Design" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/designs/type/{type}/price": {
        put: {
          tags: ["Designs"],
          summary: "Update price for all designs of a type (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "type",
              required: true,
              schema: {
                type: "string",
                enum: ["taslit", "stand", "hajj", "karbala", "davati", "hamdardi", "sarbarg", "occasion", "laser"],
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["price"],
                  properties: {
                    price: { type: "integer", example: 300000 },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Prices updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { type: "string" },
                      type: { type: "string" },
                      price: { type: "integer" },
                      updated_count: { type: "integer" },
                      designs: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Design" },
                      },
                    },
                  },
                },
              },
            },
            404: { description: "No designs for this type" },
          },
        },
      },
      "/designs/{id}": {
        get: {
          tags: ["Designs"],
          summary: "Get active design by code (public)",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Design details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { design: { $ref: "#/components/schemas/Design" } },
                  },
                },
              },
            },
            404: { description: "Not found" },
          },
        },
        put: {
          tags: ["Designs"],
          summary: "Update design (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    type: {
                      type: "string",
                      enum: ["taslit", "stand", "hajj", "karbala", "davati", "hamdardi", "sarbarg", "occasion", "laser"],
                    },
                    category: { type: "string" },
                    title: { type: "string" },
                    image_path: { type: "string" },
                    image_paths: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
                    price: { type: "integer" },
                    is_active: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Design updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { design: { $ref: "#/components/schemas/Design" } },
                  },
                },
              },
            },
            403: { description: "Admin only" },
            409: { description: "Duplicate type+code" },
          },
        },
        delete: {
          tags: ["Designs"],
          summary: "Delete design (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: { description: "Design deleted" },
            403: { description: "Admin only" },
            404: { description: "Not found" },
          },
        },
      },
      "/orders": {
        get: {
          tags: ["Orders"],
          summary: "List orders",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "status", schema: { type: "string" } },
            { in: "query", name: "user_id", schema: { type: "string", format: "uuid" }, description: "Admin only" },
            { in: "query", name: "q", schema: { type: "string" }, description: "Search by order id, note, customer name/phone, or item details" },
            { in: "query", name: "from", schema: { type: "string", format: "date" }, description: "Created from date (inclusive)" },
            { in: "query", name: "to", schema: { type: "string", format: "date" }, description: "Created to date (inclusive)" },
            { in: "query", name: "since", schema: { type: "string", format: "date-time" }, description: "Orders created after this timestamp" },
            { in: "query", name: "is_pickup", schema: { type: "boolean" }, description: "Filter pickup (true) or delivery (false)" },
            { in: "query", name: "page", schema: { type: "integer", minimum: 1 }, description: "Page number (enables pagination)" },
            { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 }, description: "Items per page (default 20)" },
          ],
          responses: {
            200: {
              description: "Orders list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      orders: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Order" },
                      },
                      total: { type: "integer", description: "Total matching orders (when paginated)" },
                      page: { type: "integer" },
                      limit: { type: "integer" },
                      pages: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Orders"],
          summary: "Create order (optional items)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    address_id: { type: "string", format: "uuid", nullable: true },
                    is_pickup: { type: "boolean", example: true },
                    status: { type: "string", example: "awaiting_payment" },
                    total_price: { type: "integer", example: 500000 },
                    note: { type: "string" },
                    user_id: { type: "string", format: "uuid", description: "Admin only" },
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["design_id", "unit_price"],
                        properties: {
                          design_id: { type: "string", format: "uuid" },
                          quantity: { type: "integer", example: 1 },
                          unit_price: { type: "integer", example: 250000 },
                          custom_data: { type: "object" },
                          item_note: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Order created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { order: { $ref: "#/components/schemas/Order" } },
                  },
                },
              },
            },
          },
        },
      },
      "/orders/{id}": {
        get: {
          tags: ["Orders"],
          summary: "Get order with items",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            200: {
              description: "Order details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { order: { $ref: "#/components/schemas/Order" } },
                  },
                },
              },
            },
            404: { description: "Not found" },
          },
        },
        put: {
          tags: ["Orders"],
          summary: "Update order",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    address_id: { type: "string", format: "uuid", nullable: true },
                    is_pickup: { type: "boolean" },
                    status: { type: "string" },
                    total_price: { type: "integer" },
                    note: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Order updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { order: { $ref: "#/components/schemas/Order" } },
                  },
                },
              },
            },
          },
        },
        delete: {
          tags: ["Orders"],
          summary: "Delete order",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            200: { description: "Order deleted" },
            404: { description: "Not found" },
          },
        },
      },
      "/orders/{id}/items": {
        get: {
          tags: ["Orders"],
          summary: "List items of an order",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            200: {
              description: "Items list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: { $ref: "#/components/schemas/OrderItem" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Orders"],
          summary: "Add item to order",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["design_id", "unit_price"],
                  properties: {
                    design_id: { type: "string", format: "uuid" },
                    quantity: { type: "integer", example: 1 },
                    unit_price: { type: "integer", example: 250000 },
                    custom_data: { type: "object" },
                    item_note: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Item created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { item: { $ref: "#/components/schemas/OrderItem" } },
                  },
                },
              },
            },
          },
        },
      },
      "/order-items": {
        get: {
          tags: ["OrderItems"],
          summary: "List order items",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "order_id", schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            200: {
              description: "Items list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: { $ref: "#/components/schemas/OrderItem" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["OrderItems"],
          summary: "Create order item",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["order_id", "design_id", "unit_price"],
                  properties: {
                    order_id: { type: "string", format: "uuid" },
                    design_id: { type: "string", format: "uuid" },
                    quantity: { type: "integer", example: 1 },
                    unit_price: { type: "integer", example: 250000 },
                    custom_data: { type: "object" },
                    item_note: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Item created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { item: { $ref: "#/components/schemas/OrderItem" } },
                  },
                },
              },
            },
          },
        },
      },
      "/order-items/{id}": {
        get: {
          tags: ["OrderItems"],
          summary: "Get order item by id",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            200: {
              description: "Item details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { item: { $ref: "#/components/schemas/OrderItem" } },
                  },
                },
              },
            },
            404: { description: "Not found" },
          },
        },
        put: {
          tags: ["OrderItems"],
          summary: "Update order item",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    design_id: { type: "string", format: "uuid" },
                    quantity: { type: "integer" },
                    unit_price: { type: "integer" },
                    custom_data: { type: "object" },
                    item_note: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Item updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { item: { $ref: "#/components/schemas/OrderItem" } },
                  },
                },
              },
            },
          },
        },
        delete: {
          tags: ["OrderItems"],
          summary: "Delete order item",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            200: { description: "Item deleted" },
            404: { description: "Not found" },
          },
        },
      },
    },
  },
  apis: [
    path.join(__dirname, "index.js"),
    path.join(__dirname, "routes", "users.js"),
    path.join(__dirname, "routes", "addresses.js"),
    path.join(__dirname, "routes", "slides.js"),
    path.join(__dirname, "routes", "downloads.js"),
    path.join(__dirname, "routes", "designs.js"),
    path.join(__dirname, "routes", "orders.js"),
    path.join(__dirname, "routes", "orderItems.js"),
  ],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
