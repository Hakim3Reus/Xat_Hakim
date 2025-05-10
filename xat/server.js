const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const salas = {};

io.on('connection', (socket) => {
  console.log('Nuevo usuario conectado:', socket.id);

  // Almacenar las salas
  socket.salasUnidas = [];

  socket.on('unir-se', ({ nom, nomSala }) => {
    if (!nom || !nomSala) {
      return socket.emit('error', 'Nombre de usuario y sala son requeridos');
    }

    nom = nom.toString().trim().substring(0, 20);
    nomSala = nomSala.toString().trim().substring(0, 30);

    // Crear la sala si no existe
    const esNuevaSala = !salas[nomSala];
    if (esNuevaSala) {
      salas[nomSala] = {
        usuarios: [],
        administradores: [nom],
        historial: [],
        creador: nom,
        timestamp: Date.now()
      };
      console.log(`Nueva sala creada: ${nomSala}`);
      
      io.emit('nueva sala creada', {
        nombre: nomSala,
        usuarios: 1,
        creador: nom
      });
    }

    // Unir a la sala si no esta ya unidop
    if (!socket.salasUnidas.includes(nomSala)) {
      socket.join(nomSala);
      socket.salasUnidas.push(nomSala);
      salas[nomSala].usuarios.push(nom);
    }

    // Establecer como la sala aactual
    socket.salaActual = nomSala;
    socket.nomUsuari = nom;

    console.log(`${nom} se unio a ${nomSala}`);

    // Enviar iinfo a la sala
    const esAdmin = salas[nomSala].administradores.includes(nom);
    socket.emit('info sala', {
      nombre: nomSala,
      esAdmin: esAdmin,
      usuarios: salas[nomSala].usuarios,
      historial: salas[nomSala].historial
    });

    // Actualizamos la lista de usuarios
    actualizarUsuariosSala(nomSala);

    if (!esNuevaSala) {
      io.to(nomSala).emit('notificacio', `${nom} se ha unido a la sala.`);
    }
  });

  // Cambiar entre las salas
  socket.on('cambiar sala', (nomSala) => {
    if (socket.salasUnidas.includes(nomSala)) {
      socket.salaActual = nomSala;
      const esAdmin = salas[nomSala].administradores.includes(socket.nomUsuari);
      socket.emit('info sala', {
        nombre: nomSala,
        esAdmin: esAdmin,
        usuarios: salas[nomSala].usuarios,
        historial: salas[nomSala].historial
      });
      console.log(`${socket.nomUsuari} cambio a sala ${nomSala}`);
    }
  });

  // Organizar mensajes y tambien enseñar la fecha
  socket.on('missatge', (dades) => {
    if (!socket.salaActual || !socket.nomUsuari) return;

    const id = Date.now().toString();
    const missatge = {
      id,
      usuari: socket.nomUsuari,
      text: dades.text,
      sala: socket.salaActual,
      timestamp: new Date().toISOString()
    };

    // Guardar en el hisotriala los mensajes
    salas[socket.salaActual].historial.push(missatge);
    
    // Enviar en la sala que se encuentre acutalmente
    io.to(socket.salaActual).emit('missatge', missatge);
    
    salas[socket.salaActual].timestamp = Date.now();
    
    io.emit('sala actualizada', {
      nombre: socket.salaActual,
      ultimoMensaje: dades.text,
      timestamp: Date.now()
    });
  });

  // Opcion de borrado de mensajes para los admins de las salas
  socket.on('borrar missatge', ({ id, sala }) => {
    const salaObj = salas[sala];
    if (salaObj && salaObj.administradores.includes(socket.nomUsuari)) {
      salaObj.historial = salaObj.historial.filter(m => m.id !== id);
      io.to(sala).emit('borrar missatge', { id });
      console.log(`${socket.nomUsuari} borró un mensaje en ${sala}`);
    }
  });

  // Haver a alaguien adminsitrador de la sala
  socket.on('afegir admin', ({ usuari, sala }) => {
    const salaObj = salas[sala];
    if (salaObj && salaObj.administradores.includes(socket.nomUsuari)) {
      if (!salaObj.administradores.includes(usuari)) {
        salaObj.administradores.push(usuari);
        io.to(sala).emit('notificacio', `${usuari} ahora es administrador.`);
        actualizarUsuariosSala(sala);
        
        io.to(sala).emit('convertit en admin', {
          usuari: usuari,
          sala: sala
        });
      }
    }
  });

  // Obtener el listado de salas
  socket.on('obtenir salas', () => {
    const salasInfo = Object.keys(salas).map(nombre => ({
      nombre,
      usuarios: salas[nombre].usuarios.length,
      creador: salas[nombre].creador,
      timestamp: salas[nombre].timestamp
    }));
    
    salasInfo.sort((a, b) => b.timestamp - a.timestamp);
    socket.emit('salas disponibles', salasInfo);
  });

  // Obtener usuarios de sala
  socket.on('obtenir usuaris', (sala) => {
    if (salas[sala]) {
      socket.emit('actualitzar usuaris', {
        usuaris: salas[sala].usuarios,
        admins: salas[sala].administradores
      });
    }
  });

  socket.on('disconnect', () => {
    if (!socket.nomUsuari) return;

    socket.salasUnidas.forEach(sala => {
      if (salas[sala]) {
        salas[sala].usuarios = salas[sala].usuarios.filter(u => u !== socket.nomUsuari);
        
        io.to(sala).emit('actualitzar usuaris', {
          usuaris: salas[sala].usuarios,
          admins: salas[sala].administradores
        });
        
        if (salas[sala].usuarios.length > 0) {
          io.to(sala).emit('notificacio', `${socket.nomUsuari} ha abandonado la sala.`);
        } else {
          // Eliminar sala si no hay usuarios
          delete salas[sala];
          io.emit('sala eliminada', sala);
        }
        
        console.log(`${socket.nomUsuari} abandonó ${sala}`);
      }
    });
  });

  function actualizarUsuariosSala(nomSala) {
    if (salas[nomSala]) {
      io.to(nomSala).emit('actualitzar usuaris', {
        usuaris: salas[nomSala].usuarios,
        admins: salas[nomSala].administradores
      });
      
      io.emit('sala actualizada', {
        nombre: nomSala,
        usuarios: salas[nomSala].usuarios.length
      });
    }
  }
});

http.listen(3000, () => {
  console.log('Servidor escuchando en http://localhost:3000');
});